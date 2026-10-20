import type { LedgerClient, ReconcileRun, SdkResult } from '@ledger/sdk';

// Slice 4 D46. Each poll costs one HTTP API request, one Lambda invocation and one Postgres read, and
// counts against the HTTP API throttle (AWS-14): at 3 s, a full 14-minute run is 280 polls, inside the
// throttle and the free tiers.
export const RUN_POLL_INTERVAL_MS = 3_000;

// The backstop, above the run's 14-minute budget: it fires only if the API's `run_abandoned`
// derivation does not. The CLI never learns or computes the budget itself (pp-cli → Waiting).
export const RUN_WAIT_BACKSTOP_MS = 1_200_000;

const MAX_POLLS = Math.ceil(RUN_WAIT_BACKSTOP_MS / RUN_POLL_INTERVAL_MS);

// What the wait ends on: the run's own result (finished, or carrying an `error` such as
// `run_abandoned`, or `getRun`'s error), or the backstop.
export type WaitOutcome =
  | { kind: 'settled'; result: SdkResult<ReconcileRun> }
  | { kind: 'backstop' };

// Polls `reconcile.getRun` every interval until the run is finished or carries an `error` (an
// abandoned run has `run_abandoned` and no `finished_at`), testing the fields, never a code literal.
export async function waitForRun(
  client: LedgerClient,
  runId: number,
  sleep: (ms: number) => Promise<void>,
): Promise<WaitOutcome> {
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    await sleep(RUN_POLL_INTERVAL_MS);
    const result = await client.reconcile.getRun(String(runId));
    if (result.error !== null) return { kind: 'settled', result };
    if (result.data.finished_at !== null || result.data.error !== null) {
      return { kind: 'settled', result };
    }
  }
  return { kind: 'backstop' };
}
