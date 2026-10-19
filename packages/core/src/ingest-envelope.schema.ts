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

// A queue body read back as an envelope, or `undefined` when it is not JSON or not an envelope: the
// failure path's reads (the worker's failure log, the DLQ inspect, invariant 4), which never throw.
export function parseIngestEnvelope(body: string): IngestEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const envelope = ingestEnvelopeSchema.safeParse(parsed);
  return envelope.success ? envelope.data : undefined;
}
