// D1: one dead message as its transport holds it. `body` is raw: parsing the envelope is the reader's
// job (D5), so no adapter knows it.
export type DlqRawMessage = { readonly body: string; readonly receiveCount: number };

// D1: `depth` is visible plus in flight, the same sum `health.get` reports
// (`QueueSnapshot.dlqVisible + dlqInFlight`).
export type DlqSample = { readonly depth: number; readonly messages: readonly DlqRawMessage[] };

export type RedriveStart =
  | { readonly status: 'started'; readonly depth: number }
  | { readonly status: 'empty'; readonly depth: 0 };

// D1: what `dlq.listMessages` and `dlq.startRedrive` need. On AWS, the DLQ and a message move task
// (`packages/aws`, D4); locally, the in-process queue's dead list (D3).
export interface DlqPort {
  // Never deletes a message and never hides one from a following redrive or depth.
  sample(limit: number): Promise<DlqSample>;
  // Throws `LedgerError('redrive_in_progress')` while a redrive is running.
  startRedrive(): Promise<RedriveStart>;
}
