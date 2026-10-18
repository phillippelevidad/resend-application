// D1, D40: local mode's synchronous invoke, under the shared contract.
import { describe, expect, it } from 'vitest';
import { InProcessFunctionInvokeAdapter } from './in-process-function-invoke.adapter.ts';
import { functionInvokePortContract } from './testing/function-invoke-port-contract.ts';

functionInvokePortContract('InProcessFunctionInvokeAdapter', (fn) => {
  return new InProcessFunctionInvokeAdapter(fn);
});

describe('InProcessFunctionInvokeAdapter', () => {
  it('turns a function that throws before awaiting into a rejected invoke', async () => {
    const invoke = new InProcessFunctionInvokeAdapter(() => {
      throw new TypeError('thrown synchronously');
    });

    await expect(invoke.invoke({})).rejects.toBeInstanceOf(TypeError);
  });
});
