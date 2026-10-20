import { z } from '@hono/zod-openapi';
import { reconcileTriggers } from '@ledger/core';
import { errorResponseSchema } from './error-response.schema.ts';

const timestamp = z.iso.datetime();
const count = z.int().min(0);

// Slice 4 D27: one reconcile run, the same shape on `gaps.list`, `reconcile.getRun`,
// `reconcile.start` and `health.get`. `error` is null, the stored outcome's registry error object,
// or `run_abandoned` derived on read; `claimed_at` and `updated_at` stay internal.
export const reconcileRunResponseSchema = z
  .object({
    object: z.literal('reconcile_run'),
    run_id: z.int().min(1),
    trigger: z.enum(reconcileTriggers),
    dry_run: z.boolean(),
    started_at: timestamp,
    finished_at: timestamp.nullable(),
    horizon_start: timestamp,
    horizon_end: timestamp,
    checked: count,
    missing: count,
    replayed: count,
    failed: count,
    error: errorResponseSchema.shape.error.nullable(),
  })
  .openapi('ReconcileRun');

export type ReconcileRunResponse = z.infer<typeof reconcileRunResponseSchema>;
