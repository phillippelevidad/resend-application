import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import type { ClockPort } from '@ledger/shared';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { GetReconcileRunReader } from './get-reconcile-run.reader.ts';
import { reconcileRunResponseMapper } from './reconcile-run-response.mapper.ts';
import { reconcileRunResponseSchema } from './reconcile-run-response.schema.ts';
import { runIdSchema } from './run-id.schema.ts';

// `reconcile.getRun` → `GET /reconcile/runs/{run_id}` (api-contract.md → reconcile.getRun).
export const getReconcileRunRoute = createRoute({
  method: 'get',
  path: '/reconcile/runs/{run_id}',
  operationId: 'reconcile.getRun',
  summary: 'One reconcile run, running, finished or abandoned',
  middleware: requireScope('read'),
  security: bearerSecurity,
  request: {
    params: z.object({
      run_id: runIdSchema.openapi({ param: { name: 'run_id', in: 'path' }, example: '42' }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: reconcileRunResponseSchema } },
      description: 'The run; one with no `finished_at` past its budget reads `run_abandoned`.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      404: '`run_not_found`: no reconcile run with this id.',
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function getReconcileRunHandler(
  reader: GetReconcileRunReader,
  clock: ClockPort,
): RouteHandler<typeof getReconcileRunRoute, ApiEnv> {
  return async (c) => {
    const { run_id } = c.req.valid('param');
    return c.json(reconcileRunResponseMapper(await reader.execute(run_id), clock.now()), 200);
  };
}
