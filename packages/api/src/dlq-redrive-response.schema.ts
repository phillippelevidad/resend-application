import { z } from '@hono/zod-openapi';

// `dlq.startRedrive`'s `202` and `200` body (design.md → D7): the status and the depth at start.
// No task handle, queue ARN or account id (AWS-61).
export const dlqRedriveResponseSchema = z
  .object({
    object: z.literal('dlq_redrive'),
    status: z.enum(['started', 'empty']),
    depth: z.int().min(0),
  })
  .openapi('DlqRedrive');

export type DlqRedriveResponse = z.infer<typeof dlqRedriveResponseSchema>;
