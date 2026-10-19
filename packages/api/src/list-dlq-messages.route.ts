import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { dlqMessageListResponseMapper } from './dlq-message-response.mapper.ts';
import { dlqMessageListResponseSchema } from './dlq-message-response.schema.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { ListDlqMessagesReader } from './list-dlq-messages.reader.ts';

// D6: 1 to 10, default 10, digits only; `create-api.ts` names this range in the route-scoped
// message, because Pagination's `limit` runs to 100.
const limitSchema = z
  .string()
  .regex(/^(?:[1-9]|10)$/)
  .transform(Number)
  .optional()
  .openapi({ param: { name: 'limit', in: 'query' }, example: '10' });

const DEFAULT_LIMIT = 10;

// `dlq.listMessages` → `GET /dlq/messages` (api-contract.md → dlq.listMessages).
export const listDlqMessagesRoute = createRoute({
  method: 'get',
  path: '/dlq/messages',
  operationId: 'dlq.listMessages',
  summary: 'A sample of dead messages and the DLQ depth, ids and counts only',
  middleware: requireScope('read'),
  security: bearerSecurity,
  request: { query: z.object({ limit: limitSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: dlqMessageListResponseSchema } },
      description: 'Up to `limit` dead messages, never removed or hidden, and the total depth.',
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
export function listDlqMessagesHandler(
  reader: ListDlqMessagesReader,
): RouteHandler<typeof listDlqMessagesRoute, ApiEnv> {
  return async (c) => {
    const { limit } = c.req.valid('query');
    const read = await reader.execute({ limit: limit ?? DEFAULT_LIMIT });
    return c.json(dlqMessageListResponseMapper(read), 200);
  };
}
