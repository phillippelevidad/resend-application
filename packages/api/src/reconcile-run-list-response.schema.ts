import { z } from '@hono/zod-openapi';
import { reconcileRunResponseSchema } from './reconcile-run-response.schema.ts';

// `gaps.list`'s body: Resend's list envelope (api-contract.md → Conventions → Pagination).
export const reconcileRunListResponseSchema = z
  .object({
    object: z.literal('list'),
    has_more: z.boolean(),
    data: z.array(reconcileRunResponseSchema),
  })
  .openapi('ReconcileRunList');

export type ReconcileRunListResponse = z.infer<typeof reconcileRunListResponseSchema>;
