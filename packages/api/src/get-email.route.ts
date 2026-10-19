import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import { bearerSecurity, requireScope } from './auth.middleware.ts';
import type { ApiEnv } from './create-api.ts';
import { emailResponseMapper } from './email-response.mapper.ts';
import { emailResponseSchema } from './email-response.schema.ts';
import { errorDescriptions, errorResponses } from './error-response.schema.ts';
import type { GetEmailReader } from './get-email.reader.ts';

// D25: Resend's UUID ids and the simulator's namespaced ids.
const emailIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,128}$/)
  .openapi({ param: { name: 'email_id', in: 'path' } });

// `email.get` → `GET /emails/{email_id}` (api-contract.md → email.get).
export const getEmailRoute = createRoute({
  method: 'get',
  path: '/emails/{email_id}',
  operationId: 'email.get',
  summary: 'The projected state of an email, its recipients and its event timeline',
  middleware: requireScope('read'),
  security: bearerSecurity,
  request: { params: z.object({ email_id: emailIdSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: emailResponseSchema } },
      description: 'The email, masks only.',
    },
    ...errorResponses({
      400: errorDescriptions[400],
      401: errorDescriptions[401],
      404: '`email_not_found`: no event has been recorded for this email id.',
      500: errorDescriptions[500],
      503: errorDescriptions[503],
    }),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function getEmailHandler(
  reader: GetEmailReader,
): RouteHandler<typeof getEmailRoute, ApiEnv> {
  return async (c) => {
    const { email_id } = c.req.valid('param');
    return c.json(emailResponseMapper(await reader.execute({ emailId: email_id })), 200);
  };
}
