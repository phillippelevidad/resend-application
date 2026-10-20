import {
  apiUnavailable,
  internalError,
  type LedgerClient,
  type ReconcileRun,
  type SdkError,
  type SdkResult,
} from '@ledger/sdk';

// Slice 4 D46. Each poll costs one HTTP API request, one Lambda invocation and one Postgres read, and
// counts against the HTTP API throttle (AWS-14): at 3 s, a full 14-minute run is 280 polls, inside the
// throttle and the free tiers.
export const RUN_POLL_INTERVAL_MS = 3_000;

// The backstop, above the run's 14-minute budget: it fires only if the API's `run_abandoned`
// derivation does not. The CLI never learns or computes the budget itself (pp-cli → Waiting).
export const RUN_WAIT_BACKSTOP_MS = 1_200_000;

const MAX_POLLS = Math.ceil(RUN_WAIT_BACKSTOP_MS / RUN_POLL_INTERVAL_MS);

// A poll's own error that says nothing about the run, which keeps going: the codes a read answers
// on a network failure, a `429` or a `5xx` (pp-backend → sdk.md, Retries): `api_unavailable` (the
// network, the HTTP API's own throttle or `5xx`, AWS-14), `database_unavailable` (`503`) and
// `internal_error` (`500`). `getRun` is a read, so polling again is safe. Any other code ends the
// wait at once.
const TRANSIENT_POLL_CODES: ReadonlySet<string> = new Set([
  apiUnavailable.code,
  internalError.code,
  'database_unavailable',
]);

// Five in a row (15 s at the interval, longer when each poll runs to the SDK's request timeout),
// chosen to outlast a throttle burst, a cold start or a database wake (not measured), yet a dead API
// surfaces in seconds, not at the backstop.
export const MAX_CONSECUTIVE_POLL_FAILURES = 5;

// What the wait ends on: the run's own result (finished, or carrying an `error` such as
// `run_abandoned`, or `getRun`'s error), or the backstop.
export type WaitOutcome =
  | { kind: 'settled'; result: SdkResult<ReconcileRun> }
  | { kind: 'backstop' };

// Polls `reconcile.getRun` every interval until the run is finished or carries an `error` (an
// abandoned run has `run_abandoned` and no `finished_at`), testing the fields, never a code literal.
// A transient poll error is retried on the next tick, `onRetry` told of it, until
// MAX_CONSECUTIVE_POLL_FAILURES in a row settle the wait on the last one; every poll counts toward
// the backstop.
export async function waitForRun(
  client: LedgerClient,
  runId: number,
  sleep: (ms: number) => Promise<void>,
  onRetry: (error: SdkError) => void = () => {},
): Promise<WaitOutcome> {
  let failures = 0;
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    await sleep(RUN_POLL_INTERVAL_MS);
    const result = await client.reconcile.getRun(String(runId));
    if (result.error !== null) {
      failures += 1;
      if (!TRANSIENT_POLL_CODES.has(result.error.code)) return { kind: 'settled', result };
      if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) return { kind: 'settled', result };
      onRetry(result.error);
      continue;
    }
    failures = 0;
    if (result.data.finished_at !== null || result.data.error !== null) {
      return { kind: 'settled', result };
    }
  }
  return { kind: 'backstop' };
}
