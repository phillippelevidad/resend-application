import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import { eventSourceResponseMapper } from './event-source-response.mapper.ts';
import { eventSourceResponseSchema } from './event-source-response.schema.ts';
import type { ResumeEventSourceCommand } from './resume-event-source.command.ts';

// `worker.resumeEventSource` → `POST /worker/resume` (api-contract.md → worker.resumeEventSource).
export const resumeEventSourceRoute = createRoute({
  method: 'post',
  path: '/worker/resume',
  operationId: 'worker.resumeEventSource',
  summary: "Probe the database and re-enable the worker's paused event source",
  middleware: requireScope('operate'),
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: eventSourceResponseSchema } },
      description: 'The resulting event-source state, and whether this call re-enabled it.',
    },
    ...errorResponses({
      401: errorDescriptions[401],
      403: errorDescriptions[403],
      500: errorDescriptions[500],
      503: '`database_unavailable`: the probe failed, so the event source stays paused.',
    }),
  },
});

// One command, one mapper, no branch on domain data (pp-backend → One route per operation).
export function resumeEventSourceHandler(
  command: ResumeEventSourceCommand,
): RouteHandler<typeof resumeEventSourceRoute, ApiEnv> {
  return async (c) => c.json(eventSourceResponseMapper(await command.execute()), 200);
}
