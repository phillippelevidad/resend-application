// D1, D40: local mode's event source control, under the shared contract.
import { describe, expect, it } from 'vitest';
import { StaticEventSourceControlAdapter } from './static-event-source-control.adapter.ts';
import { eventSourceControlPortContract } from './testing/event-source-control-port-contract.ts';

eventSourceControlPortContract(
  'StaticEventSourceControlAdapter',
  () => new StaticEventSourceControlAdapter(),
);

describe('StaticEventSourceControlAdapter', () => {
  it('reports enabled before and after a disable: local mode has nothing to pause', async () => {
    const control = new StaticEventSourceControlAdapter();

    expect(await control.getState()).toBe('enabled');
    await control.disable();
    expect(await control.getState()).toBe('enabled');
  });
});
