import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { tokenNamePattern, tokenScopeSchema } from '@ledger/core';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import type { CreateTokenCommand } from './create-token.command.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import { createdTokenResponseMapper } from './token-response.mapper.ts';
import { createdTokenResponseSchema } from './token-response.schema.ts';

// D21: the operator's label, 1 to 64 characters, starting with a letter or digit.
const nameSchema = z.string().regex(tokenNamePattern).openapi({ example: 'review-2026-10-20' });

// `token.create` → `POST /tokens` (api-contract.md → token.create).
export const createTokenRoute = createRoute({
  method: 'post',
  path: '/tokens',
  operationId: 'token.create',
  summary: 'Mint a token; its plaintext is returned this once',
  middleware: requireScope('operate'),
  security: bearerSecurity,
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ name: nameSchema, scope: tokenScopeSchema }).openapi('TokenCreate'),
        },
      },
      // Required, so a request with no body is refused rather than passed through as `{}`.
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: createdTokenResponseSchema } },
      description: 'The new token object plus `token`, the plaintext, shown only here.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      403: errorDescriptions[403],
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One command, one mapper, no branch on domain data (pp-backend → One route per operation).
export function createTokenHandler(
  command: CreateTokenCommand,
): RouteHandler<typeof createTokenRoute, ApiEnv> {
  return async (c) => {
    const { name, scope } = c.req.valid('json');
    const { row, token } = await command.execute({ name, scope });
    return c.json(createdTokenResponseMapper(row, token), 201);
  };
}
