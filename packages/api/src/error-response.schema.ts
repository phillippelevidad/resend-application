import { z } from '@hono/zod-openapi';

// The one error shape (root AGENTS.md → Error shape), on every status but 2xx. `code` is an open
// string on the wire: clients MUST treat a code they do not know as a generic failure
// (api-contract.md → Conventions), so the document does not promise a closed set.
export const errorResponseSchema = z
  .object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      hint: z.string(),
      docs: z.string(),
    }),
  })
  .openapi('Error');

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

const inErrorShape = (description: string) => ({
  content: { 'application/json': { schema: errorResponseSchema } },
  description,
});

// The four failure statuses both slice 1 operations declare, each in the error shape (D21). `404`
// is the operation's own not-found code; an unmatched path's `route_not_found` belongs to no
// operation (D23).
export function errorResponses(notFound: string) {
  return {
    400: inErrorShape('`validation_failed`: the field the message names is malformed.'),
    404: inErrorShape(notFound),
    500: inErrorShape('`internal_error`: an unexpected failure, logged by request id.'),
    503: inErrorShape('`database_unavailable`: the database is unreachable.'),
  };
}
