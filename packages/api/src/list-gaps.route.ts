import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import type { ClockPort } from '@ledger/shared';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { durationSchema } from './duration.schema.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { ListGapsReader } from './list-gaps.reader.ts';
import { reconcileRunListResponseSchema } from './reconcile-run-list-response.schema.ts';
import { reconcileRunListResponseMapper } from './reconcile-run-response.mapper.ts';
import { runIdSchema } from './run-id.schema.ts';

// api-contract.md → Conventions → Pagination: 1 to 100, default 20, digits only.
const limitSchema = z
  .string()
  .regex(/^(?:[1-9][0-9]?|100)$/)
  .transform(Number)
  .optional()
  .openapi({ param: { name: 'limit', in: 'query' }, example: '20' });

const sinceSchema = durationSchema
  .optional()
  .openapi({ param: { name: 'since', in: 'query' }, example: '24h' });

const afterSchema = runIdSchema.optional().openapi({ param: { name: 'after', in: 'query' } });

const DEFAULT_LIMIT = 20;
// api-contract.md → gaps.list: `ledger gaps` defaults to the last day.
const DEFAULT_SINCE_MS = 86_400_000;

// `gaps.list` → `GET /gaps` (api-contract.md → gaps.list).
export const listGapsRoute = createRoute({
  method: 'get',
  path: '/gaps',
  operationId: 'gaps.list',
  summary: 'Reconcile runs in the window, newest first, each with its counts and outcome',
  middleware: requireScope('read'),
  security: bearerSecurity,
  request: { query: z.object({ since: sinceSchema, limit: limitSchema, after: afterSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: reconcileRunListResponseSchema } },
      description: 'A page of runs; an unfinished run past its budget reads `run_abandoned`.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function listGapsHandler(
  reader: ListGapsReader,
  clock: ClockPort,
): RouteHandler<typeof listGapsRoute, ApiEnv> {
  return async (c) => {
    const { since, limit, after } = c.req.valid('query');
    const read = await reader.execute({
      sinceMs: since ?? DEFAULT_SINCE_MS,
      limit: limit ?? DEFAULT_LIMIT,
      after,
    });
    return c.json(reconcileRunListResponseMapper(read, clock.now()), 200);
  };
}
