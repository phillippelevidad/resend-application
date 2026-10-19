import type { EventSourceState } from '@ledger/core';
import type { EventSourceControlPort } from '../event-source-control.port.ts';
import { fakeFailure } from './fake-failure.ts';

// D1: the event source's stateful fake. `disable` leaves it `paused`, `enable` leaves it `enabled`,
// and each call can be made to fail, so a test asserts the resulting `state` (ADR-015: `paused`
// after one outage batch), never that a method was called.
export class FakeEventSourceControl implements EventSourceControlPort {
  state: EventSourceState;
  failGetState = false;
  failEnable = false;
  failDisable = false;

  constructor(state: EventSourceState = 'enabled') {
    this.state = state;
  }

  async getState(): Promise<EventSourceState> {
    if (this.failGetState) throw fakeFailure('FakeEventSourceControl.getState');
    return this.state;
  }

  async enable(): Promise<void> {
    if (this.failEnable) throw fakeFailure('FakeEventSourceControl.enable');
    this.state = 'enabled';
  }

  async disable(): Promise<void> {
    if (this.failDisable) throw fakeFailure('FakeEventSourceControl.disable');
    this.state = 'paused';
  }
}
