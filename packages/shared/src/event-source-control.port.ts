import type { EventSourceState } from '@ledger/core';

// D1, ADR-015: the worker's own event source, bound to one function. The worker disables it on a
// database outage and its resume re-enables it; `health.get` reports its state. On AWS, the event
// source mapping (AWS-18, `packages/aws`); locally, a static implementation that reports `enabled`.
export interface EventSourceControlPort {
  getState(): Promise<EventSourceState>;
  enable(): Promise<void>;
  disable(): Promise<void>;
}
