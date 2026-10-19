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

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500 | 503;

// The descriptions most operations share; an operation's own codes (`404`, `409`) are written at
// the route.
export const errorDescriptions = {
  400: '`validation_failed`: the field the message names is malformed.',
  401: '`unauthorized`: the bearer token is missing, malformed, bad-tag, unknown or revoked.',
  403: '`forbidden`: the token lacks the `operate` scope.',
  500: '`internal_error`: an unexpected failure, logged by request id.',
  503: '`database_unavailable`: the database is unreachable.',
} as const;

// Every failure status an operation declares, each in the error shape (D21), so the document lists
// exactly the entry's errors. `401` is on every operation (D18). An unmatched path's
// `route_not_found` belongs to no operation (D23).
export function errorResponses<S extends ErrorStatus>(
  descriptions: Record<S, string>,
): Record<S, ReturnType<typeof inErrorShape>> {
  const responses = {} as Record<S, ReturnType<typeof inErrorShape>>;
  for (const status of Object.keys(descriptions).map(Number) as S[]) {
    responses[status] = inErrorShape(descriptions[status]);
  }
  return responses;
}
