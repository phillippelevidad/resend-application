import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { ListTokensReader } from './list-tokens.reader.ts';
import { tokenIdSchema } from './token-id.schema.ts';
import { tokenListResponseMapper } from './token-response.mapper.ts';
import { tokenListResponseSchema } from './token-response.schema.ts';

// api-contract.md → Conventions → Pagination: 1 to 100, default 20, digits only.
const limitSchema = z
  .string()
  .regex(/^(?:[1-9][0-9]?|100)$/)
  .transform(Number)
  .optional()
  .openapi({ param: { name: 'limit', in: 'query' }, example: '20' });

const afterSchema = tokenIdSchema.optional().openapi({ param: { name: 'after', in: 'query' } });

const DEFAULT_LIMIT = 20;

// `token.list` → `GET /tokens` (api-contract.md → token.list): a read that needs `operate`, because
// the entry's Scope decides, never its section (pp-backend → Middleware).
export const listTokensRoute = createRoute({
  method: 'get',
  path: '/tokens',
  operationId: 'token.list',
  summary: 'Active and revoked tokens, newest first',
  middleware: requireScope('operate'),
  security: bearerSecurity,
  request: { query: z.object({ limit: limitSchema, after: afterSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: tokenListResponseSchema } },
      description: 'A page of tokens, never a hash or a plaintext token.',
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

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function listTokensHandler(
  reader: ListTokensReader,
): RouteHandler<typeof listTokensRoute, ApiEnv> {
  return async (c) => {
    const { limit, after } = c.req.valid('query');
    return c.json(
      tokenListResponseMapper(await reader.execute({ limit: limit ?? DEFAULT_LIMIT, after })),
      200,
    );
  };
}
