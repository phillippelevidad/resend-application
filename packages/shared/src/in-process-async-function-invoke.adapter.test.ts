// Slice 4 D7, D23: local mode's asynchronous invoke, under the shared contract.
import { describe, expect, it } from 'vitest';
import type { LogFields } from './create-logger.ts';
import { InProcessAsyncFunctionInvokeAdapter } from './in-process-async-function-invoke.adapter.ts';
import { asyncFunctionInvokePortContract } from './testing/async-function-invoke-port-contract.ts';

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

asyncFunctionInvokePortContract('InProcessAsyncFunctionInvokeAdapter', (fn) => {
  return new InProcessAsyncFunctionInvokeAdapter(fn, silentLogger);
});

describe('InProcessAsyncFunctionInvokeAdapter', () => {
  it('logs a failed function by its error name only, never its message', async () => {
    const lines: { message: string; fields: LogFields | undefined }[] = [];
    let settled: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const logger = {
      ...silentLogger,
      error: (message: string, fields?: LogFields) => {
        lines.push({ message, fields });
        settled();
      },
    };
    const invoke = new InProcessAsyncFunctionInvokeAdapter(() => {
      throw new TypeError('failed near delivered@resend.dev');
    }, logger);

    await invoke.invokeAsync({});
    await done;

    expect(lines).toEqual([
      { message: 'invoke.async_failed', fields: { error_name: 'TypeError' } },
    ]);
  });
});
