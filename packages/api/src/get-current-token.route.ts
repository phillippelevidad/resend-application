import { createRoute, type RouteHandler } from '@hono/zod-openapi';
import { bearerSecurity, requireScope, verifiedCaller } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { GetCurrentTokenReader } from './get-current-token.reader.ts';
import { tokenResponseMapper } from './token-response.mapper.ts';
import { tokenResponseSchema } from './token-response.schema.ts';

// `token.getCurrent` → `GET /tokens/current` (api-contract.md → token.getCurrent).
export const getCurrentTokenRoute = createRoute({
  method: 'get',
  path: '/tokens/current',
  operationId: 'token.getCurrent',
  summary: "The calling token's id, name and scope",
  middleware: requireScope('read'),
  security: bearerSecurity,
  responses: {
    200: {
      content: { 'application/json': { schema: tokenResponseSchema } },
      description: 'The calling token, never its hash.',
    },
    ...errorResponses({
      401: errorDescriptions[401],
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function getCurrentTokenHandler(
  reader: GetCurrentTokenReader,
): RouteHandler<typeof getCurrentTokenRoute, ApiEnv> {
  return async (c) => {
    const { tokenId } = verifiedCaller(c);
    return c.json(tokenResponseMapper(await reader.execute({ tokenId })), 200);
  };
}
