import type { EventSourceState } from '@ledger/core';
import type { EventSourceControlPort } from './event-source-control.port.ts';

// D1, D40: local mode has no event source mapping to pause, so it reports `enabled`, and enable and
// disable are no-ops (api-contract.md → worker.resumeEventSource: "In local mode it is a no-op that
// reports the state").
export class StaticEventSourceControlAdapter implements EventSourceControlPort {
  async getState(): Promise<EventSourceState> {
    return 'enabled';
  }

  async enable(): Promise<void> {}

  async disable(): Promise<void> {}
}
