import { z } from 'zod';

// D12: which secret verified the delivery. `simulated` is the simulator secret (ADR-016); slice 1's
// `webhook_events.source` CHECK mirrors this set.
export const eventSourceSchema = z.enum(['live', 'simulated']);

// D12: what ingest enqueues for one verified delivery, and what the worker parses back. The raw body
// travels byte for byte (RS-01). `svix-signature` is not carried: nothing re-verifies a stored
// event, and an unknown key is stripped on parse.
export const ingestEnvelopeSchema = z.object({
  svixId: z.string().min(1),
  receivedAt: z.iso.datetime({ offset: true }),
  source: eventSourceSchema,
  rawBody: z.string(),
  headers: z.object({ 'svix-timestamp': z.string() }),
});

export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
