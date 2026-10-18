import { describe, expect, it } from 'vitest';
import type { FunctionInvokePort } from '../function-invoke.port.ts';

// The function an implementation invokes: what it answers for a payload, or a rejection for a
// function error.
export type InvokedFunction = (payload: unknown) => Promise<unknown>;

// D1: what every `FunctionInvokePort` shares. `make` binds an implementation to `fn` (on AWS, the
// stubbed client answers as `fn` would). Payloads and results are JSON, as a Lambda's are.
export function functionInvokePortContract(
  name: string,
  make: (fn: InvokedFunction) => FunctionInvokePort | Promise<FunctionInvokePort>,
): void {
  describe(`FunctionInvokePort contract: ${name}`, () => {
    it('invoke awaits the function and resolves with its result for the payload sent', async () => {
      const port = await make(async (payload) => ({ outcome: 'resumed', received: payload }));

      await expect(port.invoke({ action: 'resume' })).resolves.toEqual({
        outcome: 'resumed',
        received: { action: 'resume' },
      });
    });

    it('invoke rejects when the function fails', async () => {
      const port = await make(async () => {
        throw new TypeError('function failed');
      });

      await expect(port.invoke({ action: 'resume' })).rejects.toBeInstanceOf(Error);
    });
  });
}
