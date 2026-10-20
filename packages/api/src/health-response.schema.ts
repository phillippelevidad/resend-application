import { z } from '@hono/zod-openapi';
import { eventSourceStateSchema } from '@ledger/core';
import { reconcileRunResponseSchema } from './reconcile-run-response.schema.ts';

const count = z.int().min(0);

// `health.get`'s `200` body (design.md → Surfaces): counts, a state and byte sizes only. During a
// database outage it still answers, `reachable: false` and `storage_bytes: null` (D19).
export const healthResponseSchema = z
  .object({
    object: z.literal('health'),
    queue: z.object({
      visible: count,
      in_flight: count,
      // `null` when the queue reported no datapoint (AWS-22).
      oldest_age_seconds: count.nullable(),
    }),
    dlq: z.object({ visible: count, in_flight: count }),
    event_source: z.object({ state: eventSourceStateSchema }),
    database: z.object({
      reachable: z.boolean(),
      storage_bytes: count.nullable(),
      storage_limit_bytes: count,
    }),
    // Slice 4 D27: the newest run, `null` before the first one or while the database is unreachable.
    // A union, not `.nullable()`: that would make the registered `ReconcileRun` component itself
    // nullable, and with it every run in the document and the SDK types.
    last_reconcile_run: z.union([reconcileRunResponseSchema, z.null()]),
  })
  .openapi('Health');

export type HealthResponse = z.infer<typeof healthResponseSchema>;
