import { createRoute, type RouteHandler, z } from '@hono/zod-openapi';
import type { ApiEnv } from './create-api.ts';
import { errorResponses } from './error-response.schema.ts';
import type { GetRecipientReader } from './get-recipient.reader.ts';
import { recipientResponseMapper } from './recipient-response.mapper.ts';
import { recipientResponseSchema } from './recipient-response.schema.ts';

// D24: trimmed length 3–320, one `@` with a non-empty part on each side. The reader normalizes
// before hashing (D1), so case is not checked here.
const addressSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .regex(/^[^@]+@[^@]+$/)
  .openapi({ example: 'delivered@resend.dev' });

// `recipient.get` → `POST /recipients/lookup` (api-contract.md → recipient.get): a `POST` only so
// the address travels in the body, never in a path or query string (Conventions → Redaction).
export const getRecipientRoute = createRoute({
  method: 'post',
  path: '/recipients/lookup',
  operationId: 'recipient.get',
  summary: 'The deliverability of an address and the email that caused it',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({ address: addressSchema }).openapi('RecipientLookup'),
        },
      },
      // Required, so a request with no body is validated (and refused) rather than passed through
      // as `{}` by `@hono/zod-openapi`.
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: recipientResponseSchema } },
      description: 'The recipient, the address only as its mask.',
    },
    ...errorResponses('`recipient_not_found`: no event has ever named this address.'),
  },
});

// One reader, one mapper, no branch on domain data (pp-backend → One route per operation).
export function getRecipientHandler(
  reader: GetRecipientReader,
): RouteHandler<typeof getRecipientRoute, ApiEnv> {
  return async (c) => {
    const { address } = c.req.valid('json');
    return c.json(recipientResponseMapper(await reader.execute({ address })), 200);
  };
}
