import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import type { ApiEnv } from './create-api.ts';
import { emailResponseMapper } from './email-response.mapper.ts';
import { emailResponseSchema } from './email-response.schema.ts';
import { errorResponses } from './error-response.schema.ts';
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
  request: { params: z.object({ email_id: emailIdSchema }) },
  responses: {
    200: {
      content: { 'application/json': { schema: emailResponseSchema } },
      description: 'The email, masks only.',
    },
    ...errorResponses('`email_not_found`: no event has been recorded for this email id.'),
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
