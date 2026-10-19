import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { dlqRedriveResponseMapper } from './dlq-redrive-response.mapper.ts';
import { dlqRedriveResponseSchema } from './dlq-redrive-response.schema.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { StartDlqRedriveCommand } from './start-dlq-redrive.command.ts';

// `dlq.startRedrive` → `POST /dlq/redrive` (api-contract.md → dlq.startRedrive).
export const startDlqRedriveRoute = createRoute({
  method: 'post',
  path: '/dlq/redrive',
  operationId: 'dlq.startRedrive',
  summary: 'Move every dead message back to the source queue',
  middleware: requireScope('operate'),
  security: bearerSecurity,
  responses: {
    202: {
      content: { 'application/json': { schema: dlqRedriveResponseSchema } },
      description:
        '`status: started`: a redrive is moving `depth` messages; watch the DLQ depth fall in `health.get`.',
    },
    200: {
      content: { 'application/json': { schema: dlqRedriveResponseSchema } },
      description: '`status: empty`: the DLQ held nothing, so no redrive started.',
    },
    ...errorResponses({
      401: errorDescriptions[401],
      403: errorDescriptions[403],
      409: '`redrive_in_progress`: a redrive task is already running; SQS allows one per queue.',
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One command, one mapper (pp-backend → One route per operation). D7: a started redrive answers
// `202`, an empty DLQ `200`, with the same body.
export function startDlqRedriveHandler(
  command: StartDlqRedriveCommand,
): RouteHandler<typeof startDlqRedriveRoute, ApiEnv> {
  return async (c) => {
    const result = await command.execute();
    return result.status === 'started'
      ? c.json(dlqRedriveResponseMapper(result), 202)
      : c.json(dlqRedriveResponseMapper(result), 200);
  };
}
