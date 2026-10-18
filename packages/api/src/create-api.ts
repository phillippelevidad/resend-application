import { type Hook, OpenAPIHono } from '@hono/zod-openapi';
import { type ErrorCode, errorRegistry } from '@ledger/core';
import { classifyDatabaseError, type Executor } from '@ledger/db';
import {
  type EventSourceControlPort,
  errorFields,
  type FunctionInvokePort,
  LedgerError,
  type Logger,
  type QueueAttributesPort,
} from '@ledger/shared';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type RequestIdVariables, requestId } from 'hono/request-id';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type AuthVariables, authMiddleware } from './auth.middleware.ts';
import { CreateTokenCommand } from './create-token.command.ts';
import { createTokenHandler, createTokenRoute } from './create-token.route.ts';
import { type ErrorOverrides, errorResponseMapper } from './error-response.mapper.ts';
import { GetCurrentTokenReader } from './get-current-token.reader.ts';
import { getCurrentTokenHandler, getCurrentTokenRoute } from './get-current-token.route.ts';
import { GetEmailReader } from './get-email.reader.ts';
import { getEmailHandler, getEmailRoute } from './get-email.route.ts';
import { GetHealthReader } from './get-health.reader.ts';
import { getHealthHandler, getHealthRoute } from './get-health.route.ts';
import { GetRecipientReader } from './get-recipient.reader.ts';
import { getRecipientHandler, getRecipientRoute } from './get-recipient.route.ts';
import { ListTokensReader } from './list-tokens.reader.ts';
import { listTokensHandler, listTokensRoute } from './list-tokens.route.ts';
import { ResumeEventSourceCommand } from './resume-event-source.command.ts';
import { resumeEventSourceHandler, resumeEventSourceRoute } from './resume-event-source.route.ts';
import { RevokeTokenCommand } from './revoke-token.command.ts';
import { revokeTokenHandler, revokeTokenRoute } from './revoke-token.route.ts';

// D22. Every dependency is injected by the root, so this package imports no Lambda type and no AWS
// SDK: `requestId` matches Hono's `generator` (`apps/api` returns the Lambda request id,
// `apps/local` `crypto.randomUUID()`); the three ports are SQS, Lambda and the worker on AWS, the
// in-process implementations locally.
export type ApiDeps = {
  db: Executor;
  logger: Logger;
  addressHashKey: Uint8Array;
  tokenTagKey: Uint8Array;
  requestId: (c: Context) => string;
  queueAttributes: QueueAttributesPort;
  eventSource: EventSourceControlPort;
  workerInvoke: FunctionInvokePort;
  storageLimitBytes: number;
};

export type ApiEnv = { Variables: RequestIdVariables & AuthVariables };

const bodyHint = 'Send Content-Type: application/json with a JSON body.';

// design.md → Surfaces → Error codes raised: a validation message names the field, never its value.
const fieldErrors = {
  email_id: {
    message: "email_id must be 1 to 128 characters from A-Z, a-z, 0-9, '.', '_' and '-'.",
  },
  address: { message: 'address must be an email address of at most 320 characters.' },
  name: {
    message:
      "name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit.",
  },
  scope: { message: 'scope must be read or operate.' },
  token_id: { message: 'token_id must be a positive integer.' },
  limit: { message: 'limit must be an integer from 1 to 100.' },
  after: { message: 'after must be a token id, a positive integer.' },
} satisfies Record<string, ErrorOverrides>;

// Each JSON-body route's body message and the fields its own message names (D22: keyed by the
// matched route's path). Hono registers `{param}` as `:param`; both body routes have static paths.
const bodyErrors: Record<string, { body: ErrorOverrides; fields: (keyof typeof fieldErrors)[] }> = {
  [getRecipientRoute.path]: {
    body: {
      message: 'The request body must be a JSON object with an address field.',
      hint: bodyHint,
    },
    fields: ['address'],
  },
  [createTokenRoute.path]: {
    body: {
      message: 'The request body must be a JSON object with name and scope fields.',
      hint: bodyHint,
    },
    fields: ['name', 'scope'],
  },
};

const paramFields: ReadonlySet<string> = new Set(['email_id', 'token_id', 'limit', 'after']);

// D22's `defaultHook`: every request-validation failure is `400 validation_failed`. A path or query
// field names itself. In a JSON body, a field of the right type that fails its rule names itself;
// a body that is absent, not an object, or lacks a field of the right type names the body. No
// route passes its own hook (pp-backend → Errors).
const validationHook: Hook<unknown, ApiEnv, string, Response | undefined> = (result, c) => {
  if (result.success) {
    return undefined;
  }
  const issue = result.error.issues[0];
  const field = issue?.path[0];
  let overrides: ErrorOverrides = {};
  if ((result.target === 'param' || result.target === 'query') && typeof field === 'string') {
    if (paramFields.has(field)) {
      overrides = fieldErrors[field as keyof typeof fieldErrors];
    }
  } else if (result.target === 'json') {
    const route = bodyErrors[routePath(c)];
    const named = route?.fields.find((name) => name === field);
    if (route !== undefined) {
      overrides =
        named !== undefined && issue?.code !== 'invalid_type' ? fieldErrors[named] : route.body;
    }
  }
  return c.json(errorResponseMapper('validation_failed', overrides), 400);
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
    // D19, D20: an AWS port failure arrives raised as `internal_error`, the SDK error as `cause`. It
    // is answered as raised, before the classifier, which would read an SDK socket error
    // (`ECONNRESET`) in that `cause` as the database. Logged by the cause's name.
    if (err instanceof LedgerError && err.code === 'internal_error') {
      logger.error('api.internal_error', {
        request_id: c.get('requestId'),
        ...errorFields(err.cause ?? err),
      });
      return respond(c, 'internal_error', { message: err.message, hint: err.hint, docs: err.docs });
    }
    // C3: the classifier next, so a driver error wrapped anywhere answers `503`.
    if (classifyDatabaseError(err) !== undefined) {
      return respond(c, 'database_unavailable');
    }
    // `@hono/zod-openapi` 1.6.3's media-type gate throws `415` when the `Content-Type` is not JSON
    // (or is missing while a body is sent), and Hono's validator throws `400` on malformed JSON;
    // both bypass `defaultHook`, so the matched route's body message is named here (D22).
    if (err instanceof HTTPException && (err.status === 415 || err.status === 400)) {
      return respond(c, 'validation_failed', bodyErrors[routePath(c)]?.body);
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
  // client header nor sets one (pp-backend → Middleware).
  app.use(requestId({ headerName: '', generator: deps.requestId }));
  // D18: before every route and the not-found handler, so an unmatched path still needs a token.
  app.use(
    authMiddleware({
      db: deps.db,
      tokenTagKey: deps.tokenTagKey,
      outageRoute: { method: getHealthRoute.method, path: getHealthRoute.path },
    }),
  );
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
  });

  app.openapi(getEmailRoute, getEmailHandler(new GetEmailReader(deps.db)));
  app.openapi(
    getRecipientRoute,
    getRecipientHandler(new GetRecipientReader(deps.db, deps.addressHashKey)),
  );
  app.openapi(
    getHealthRoute,
    getHealthHandler(
      new GetHealthReader({
        db: deps.db,
        queueAttributes: deps.queueAttributes,
        eventSource: deps.eventSource,
        storageLimitBytes: deps.storageLimitBytes,
      }),
    ),
  );
  app.openapi(
    resumeEventSourceRoute,
    resumeEventSourceHandler(new ResumeEventSourceCommand(deps.workerInvoke)),
  );
  app.openapi(getCurrentTokenRoute, getCurrentTokenHandler(new GetCurrentTokenReader(deps.db)));
  app.openapi(listTokensRoute, listTokensHandler(new ListTokensReader(deps.db)));
  app.openapi(
    createTokenRoute,
    createTokenHandler(new CreateTokenCommand(deps.db, deps.tokenTagKey)),
  );
  app.openapi(revokeTokenRoute, revokeTokenHandler(new RevokeTokenCommand(deps.db)));

  // D23: any method and path no operation serves, never Hono's plain-text default.
  app.notFound((c) => respond(c, 'route_not_found'));
  app.onError(onError(deps.logger));
  return app;
}
