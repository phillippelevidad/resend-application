import { type Hook, OpenAPIHono } from '@hono/zod-openapi';
import { type ErrorCode, errorRegistry } from '@ledger/core';
import { classifyDatabaseError, type Executor } from '@ledger/db';
import { errorFields, LedgerError, type Logger } from '@ledger/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type RequestIdVariables, requestId } from 'hono/request-id';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type ErrorOverrides, errorResponseMapper } from './error-response.mapper.ts';
import { GetEmailReader } from './get-email.reader.ts';
import { getEmailHandler, getEmailRoute } from './get-email.route.ts';
import { GetRecipientReader } from './get-recipient.reader.ts';
import { getRecipientHandler, getRecipientRoute } from './get-recipient.route.ts';

// D21. `requestId` is injected by the root: `apps/local` passes `crypto.randomUUID`, `apps/api` the
// Lambda request id (slice 2), so this package imports no Lambda type.
export type ApiDeps = {
  db: Executor;
  logger: Logger;
  addressHashKey: Uint8Array;
  requestId: () => string;
};

export type ApiEnv = { Variables: RequestIdVariables };

// design.md → Surfaces → Error codes raised: a validation message names the field, never its value.
const fieldErrors = {
  email_id: {
    message: "email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.",
  },
  address: { message: 'address must be an email address of at most 320 characters.' },
  body: {
    message: 'The request body must be a JSON object with an address field.',
    hint: 'Send Content-Type: application/json with a JSON body.',
  },
} satisfies Record<string, ErrorOverrides>;

// D22's `defaultHook`: every request-validation failure is `400 validation_failed`. A JSON body
// whose `address` is a string that fails D24 names `address`; a body that is absent, not an object
// or has no string `address` names the body. No route passes its own hook (pp-backend → Errors).
const validationHook: Hook<unknown, ApiEnv, string, Response | undefined> = (result, c) => {
  if (result.success) {
    return undefined;
  }
  const issue = result.error.issues[0];
  let field: keyof typeof fieldErrors | undefined;
  if (result.target === 'param' && issue?.path[0] === 'email_id') {
    field = 'email_id';
  } else if (result.target === 'json') {
    field = issue?.path[0] === 'address' && issue.code !== 'invalid_type' ? 'address' : 'body';
  }
  return c.json(
    errorResponseMapper('validation_failed', field === undefined ? {} : fieldErrors[field]),
    400,
  );
};

function respond(c: Context<ApiEnv>, code: ErrorCode, overrides: ErrorOverrides = {}): Response {
  // Only codes with a registry status reach here (the caller checks); `500` is the defect fallback.
  const status = (errorRegistry[code].status ?? 500) as ContentfulStatusCode;
  return c.json(errorResponseMapper(code, overrides), status);
}

// The read API's one error mapper (pp-general → One mapping per surface). Anything not mapped is
// `500 internal_error`, logged by name and request id, its message never sent.
function onError(logger: Logger) {
  return (err: Error, c: Context<ApiEnv>): Response => {
    // C3: the classifier first, so a driver error wrapped anywhere answers `503`.
    if (classifyDatabaseError(err) !== undefined) {
      return respond(c, 'database_unavailable');
    }
    // `@hono/zod-openapi` 1.6.3's media-type gate throws `415` when the `Content-Type` is not JSON
    // (or is missing while a body is sent), and Hono's validator throws `400` on malformed JSON;
    // both bypass `defaultHook` (D22). Slice 1's one body route is `recipient.get`, so both name
    // the body.
    if (err instanceof HTTPException && (err.status === 415 || err.status === 400)) {
      return respond(c, 'validation_failed', fieldErrors.body);
    }
    // A run-outcome or client-side code has no HTTP status: a defect here (pp-general → Errors).
    if (err instanceof LedgerError && errorRegistry[err.code].status !== null) {
      return respond(c, err.code, { message: err.message, hint: err.hint, docs: err.docs });
    }
    logger.error('api.internal_error', { request_id: c.get('requestId'), ...errorFields(err) });
    return respond(c, 'internal_error');
  };
}

// One Hono app object, served by @hono/aws-lambda and @hono/node-server alike (ADR-011, ADR-019).
export function createApi(deps: ApiDeps): OpenAPIHono<ApiEnv> {
  const app = new OpenAPIHono<ApiEnv>({ defaultHook: validationHook });

  // The request id is a log field, never a response header: `headerName: ''` neither reads a
  // client header nor sets one (pp-backend → Middleware). Slice 1 has no token middleware: the
  // loopback server skips auth (api-contract.md → Conventions → Auth in slice 1).
  app.use(requestId({ headerName: '', generator: () => deps.requestId() }));

  app.openapi(getEmailRoute, getEmailHandler(new GetEmailReader(deps.db)));
  app.openapi(
    getRecipientRoute,
    getRecipientHandler(new GetRecipientReader(deps.db, deps.addressHashKey)),
  );

  // D23: any method and path no operation serves, never Hono's plain-text default.
  app.notFound((c) => respond(c, 'route_not_found'));
  app.onError(onError(deps.logger));
  return app;
}
