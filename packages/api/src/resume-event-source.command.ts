import {
  type EventSourceState,
  errorRegistry,
  eventSourceStateSchema,
  RESUME_EVENT,
  resumeOutcomes,
} from '@ledger/core';
import { type FunctionInvokePort, LedgerError } from '@ledger/shared';
import { z } from 'zod';

// D16's `ResumeResult`, parsed here because the invoke's answer crosses a function boundary: the API
// never trusts it unparsed (D20). D17's `RESUME_EVENT` is what the worker's handler answers.
const resumeResultSchema = z.object({
  outcome: z.enum(resumeOutcomes),
  state: eventSourceStateSchema,
});

// design.md → Surfaces: the override of `database_unavailable`'s message for a failed probe.
const PROBE_FAILED_MESSAGE =
  'The database is unreachable or at its storage limit, so the event source stays paused.';

export type ResumeEventSourceInput = Record<string, never>;

export type ResumeEventSourceResult = { state: EventSourceState; resumed: boolean };

// `worker.resumeEventSource` (api-contract.md, D20): the on-demand form of ADR-015's hourly resume.
// It writes nothing itself: the worker probes and re-enables. An invoke failure propagates to
// `onError` as `500 internal_error`, logged.
export class ResumeEventSourceCommand {
  readonly #workerInvoke: FunctionInvokePort;

  constructor(workerInvoke: FunctionInvokePort) {
    this.#workerInvoke = workerInvoke;
  }

  async execute(_input: ResumeEventSourceInput = {}): Promise<ResumeEventSourceResult> {
    // As in `GetHealthReader`: an invoke failure is raised as `internal_error`, the SDK error as
    // `cause`, so `onError` answers `500` and logs the SDK error's name (D20).
    const answer = await this.#workerInvoke.invoke(RESUME_EVENT).catch((err: unknown) => {
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, { cause: err });
    });
    const parsed = resumeResultSchema.safeParse(answer);
    if (!parsed.success) {
      throw new LedgerError('internal_error', errorRegistry.internal_error.message, {
        cause: parsed.error,
      });
    }
    const { outcome, state } = parsed.data;
    if (outcome === 'probe_failed') {
      throw new LedgerError('database_unavailable', PROBE_FAILED_MESSAGE);
    }
    return { state, resumed: outcome === 'resumed' };
  }
}
