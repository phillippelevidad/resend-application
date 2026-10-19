import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { RevokeTokenCommand } from './revoke-token.command.ts';
import { tokenIdSchema } from './token-id.schema.ts';
import { tokenResponseMapper } from './token-response.mapper.ts';
import { tokenResponseSchema } from './token-response.schema.ts';

// `token.revoke` → `POST /tokens/{token_id}/revoke` (api-contract.md → token.revoke).
export const revokeTokenRoute = createRoute({
  method: 'post',
  path: '/tokens/{token_id}/revoke',
  operationId: 'token.revoke',
  summary: 'Revoke a token; its next request answers 401',
  middleware: requireScope('operate'),
  security: bearerSecurity,
  request: {
    params: z.object({
      token_id: tokenIdSchema.openapi({ param: { name: 'token_id', in: 'path' } }),
    }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: tokenResponseSchema } },
      description: 'The revoked token; a revoked one is returned unchanged.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      403: errorDescriptions[403],
      404: '`token_not_found`: no token with this id.',
      409: '`last_operate_token`: revoking it would leave no active `operate` token.',
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One command, one mapper, no branch on domain data (pp-backend → One route per operation).
export function revokeTokenHandler(
  command: RevokeTokenCommand,
): RouteHandler<typeof revokeTokenRoute, ApiEnv> {
  return async (c) => {
    const { token_id } = c.req.valid('param');
    return c.json(tokenResponseMapper(await command.execute({ tokenId: token_id })), 200);
  };
}
