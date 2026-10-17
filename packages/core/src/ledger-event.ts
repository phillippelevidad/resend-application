// D3: a stored `webhook_events` row as a projection sees it. `received_at`, `source` and the typed
// `email_id` are left out, so projection code cannot read arrival time (Reliability core design
// test). `recipientKeys[i]` keys `data.to[i]`: slice 1 passes `to_hashes`, slice 0's arbitraries
// pass `normalizeAddress(to[i])`.
export type LedgerEvent = {
  readonly svixId: string;
  readonly type: string;
  readonly eventCreatedAt: Date | null;
  readonly recipientKeys: readonly string[] | null;
  readonly payload: unknown;
};
