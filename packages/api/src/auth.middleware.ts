import { errorRegistry, type TokenScope } from '@ledger/core';
import {
  type ActiveApiToken,
  apiTokensRepository,
  classifyDatabaseError,
  type Executor,
} from '@ledger/db';
import { hashApiToken, hasValidTag, LedgerError } from '@ledger/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from './create-api.ts';

// D18: who is calling. `verified: false` only on `GET /health` during a database outage, where the
// token's tag is the whole check (api-contract.md → Conventions → Auth).
export type Caller =
  | { verified: true; tokenId: number; name: string; scope: TokenScope }
  | { verified: false };

export type AuthVariables = { caller: Caller };

// The OpenAPI requirement every operation carries; the scheme is registered by `createApi`.
export const bearerSecurity = [{ bearerAuth: [] }];

const bearerHeader = /^Bearer ([^\s]+)$/i;

// The registry's default message for every `401`, so a response never tells which check failed
// (D18).
const unauthorized = (): LedgerError =>
  new LedgerError('unauthorized', errorRegistry.unauthorized.message);

export type AuthMiddlewareDeps = {
  db: Executor;
  tokenTagKey: Uint8Array;
  // The one operation that answers on the tag alone during an outage: `health.get`'s method and
  // path, passed by `createApi` from the route, so this file imports no route.
  outageRoute: { method: string; path: string };
};

// D18, after the request id and before every route and the not-found handler: the tag check before
// any database connection opens, then the lookup by hash. A thrown error reaches the app's one
// `onError`, which maps it (pp-general → One mapping per surface).
export function authMiddleware({
  db,
  tokenTagKey,
  outageRoute,
}: AuthMiddlewareDeps): MiddlewareHandler<ApiEnv> {
  const isOutageRoute = (c: Context<ApiEnv>): boolean =>
    c.req.method === outageRoute.method.toUpperCase() && c.req.path === outageRoute.path;
  return async (c, next) => {
    const token = bearerHeader.exec(c.req.header('authorization') ?? '')?.[1];
    if (token === undefined || !hasValidTag(token, tokenTagKey)) {
      throw unauthorized();
    }
    let row: ActiveApiToken | undefined;
    try {
      row = await apiTokensRepository.findActiveByHash(db, hashApiToken(token));
    } catch (err) {
      // During an outage `health.get` answers on the tag alone; every other route answers `503`
      // through `onError`. The health reader then makes no second attempt (D19).
      if (classifyDatabaseError(err) !== undefined && isOutageRoute(c)) {
        c.set('caller', { verified: false });
        return next();
      }
      throw err;
    }
    if (row === undefined) {
      throw unauthorized();
    }
    c.set('caller', { verified: true, tokenId: row.id, name: row.name, scope: row.scope });
    return next();
  };
}

// D18: each route's middleware, its api-contract entry's Scope; `operate` satisfies `read`. An
// unverified caller exists only on `health.get` (`read`); anywhere else it fails closed.
export function requireScope(needed: TokenScope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const caller = c.get('caller');
    if (!caller.verified) {
      if (needed === 'read') {
        return next();
      }
      throw new LedgerError('database_unavailable', errorRegistry.database_unavailable.message);
    }
    if (needed === 'operate' && caller.scope !== 'operate') {
      throw new LedgerError('forbidden', errorRegistry.forbidden.message);
    }
    return next();
  };
}

// The caller a token route acts for. Only `health.get` admits an unverified caller, so this never
// fails behind the middleware; it narrows the type.
export function verifiedCaller(c: Context<ApiEnv>): Extract<Caller, { verified: true }> {
  const caller = c.get('caller');
  if (!caller.verified) {
    throw unauthorized();
  }
  return caller;
}
