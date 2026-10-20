import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import type { ClockPort } from '@ledger/shared';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { GetHealthReader } from './get-health.reader.ts';
import { healthResponseMapper } from './health-response.mapper.ts';
import { healthResponseSchema } from './health-response.schema.ts';

// `health.get` → `GET /health` (api-contract.md → health.get). Its method and path are also the
// auth middleware's outage exception (D18).
export const getHealthRoute = createRoute({
  method: 'get',
  path: '/health',
  operationId: 'health.get',
  summary:
    'Queue and DLQ depth, the worker event source, database reachability and storage, and the last reconcile run',
  middleware: requireScope('read'),
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: healthResponseSchema } },
      description: 'The pipeline, also during a database outage (`database.reachable: false`).',
    },
    ...errorResponses({ 401: errorDescriptions[401], 500: errorDescriptions[500] }),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function getHealthHandler(
  reader: GetHealthReader,
  clock: ClockPort,
): RouteHandler<typeof getHealthRoute, ApiEnv> {
  return async (c) => {
    const { verified } = c.get('caller');
    return c.json(healthResponseMapper(await reader.execute({ verified }), clock.now()), 200);
  };
}
