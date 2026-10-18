import { eventSourceStates } from '@ledger/core';
import { describe, expect, it } from 'vitest';
import type { EventSourceControlPort } from '../event-source-control.port.ts';

// D1: what every `EventSourceControlPort` shares. What a state change does is each side's own test:
// locally enable and disable are no-ops, on AWS they update the mapping.
export function eventSourceControlPortContract(
  name: string,
  make: () => EventSourceControlPort | Promise<EventSourceControlPort>,
): void {
  describe(`EventSourceControlPort contract: ${name}`, () => {
    it('getState answers a member of eventSourceStates', async () => {
      const control = await make();

      expect(eventSourceStates).toContain(await control.getState());
    });

    it('enable resolves', async () => {
      const control = await make();

      await expect(control.enable()).resolves.toBeUndefined();
    });

    it('disable resolves', async () => {
      const control = await make();

      await expect(control.disable()).resolves.toBeUndefined();
    });
  });
}
