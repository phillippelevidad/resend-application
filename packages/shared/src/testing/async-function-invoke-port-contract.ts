import { describe, expect, it } from 'vitest';
import type { AsyncFunctionInvokePort } from '../async-function-invoke.port.ts';

// The function an implementation invokes; what it resolves with is never seen by the caller.
export type AsyncInvokedFunction = (payload: unknown) => Promise<unknown>;

// A promise and its resolver, so a test controls when the invoked function finishes.
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Slice 4 D7: what every `AsyncFunctionInvokePort` shares. `make` binds an implementation to `fn`
// (on AWS, the stubbed client runs `fn` as Lambda would and answers `202` at once). Payloads are
// JSON, as a Lambda's are.
export function asyncFunctionInvokePortContract(
  name: string,
  make: (fn: AsyncInvokedFunction) => AsyncFunctionInvokePort | Promise<AsyncFunctionInvokePort>,
): void {
  describe(`AsyncFunctionInvokePort contract: ${name}`, () => {
    it('hands the payload to the function unchanged', async () => {
      const received = deferred<unknown>();
      const port = await make(async (payload) => {
        received.resolve(payload);
      });

      await port.invokeAsync({ ledger: 'reconcile-run', run_id: 42 });

      await expect(received.promise).resolves.toEqual({ ledger: 'reconcile-run', run_id: 42 });
    });

    it('resolves before the function finishes', async () => {
      const release = deferred<void>();
      let finished = false;
      const port = await make(async () => {
        await release.promise;
        finished = true;
      });

      await port.invokeAsync({ ledger: 'reconcile-run', run_id: 1 });

      expect(finished).toBe(false);
      release.resolve();
    });

    it('never rejects when the function fails', async () => {
      const failed = deferred<void>();
      const port = await make(async () => {
        failed.resolve();
        throw new TypeError('function failed');
      });

      await expect(
        port.invokeAsync({ ledger: 'reconcile-run', run_id: 2 }),
      ).resolves.toBeUndefined();
      await failed.promise;
    });
  });
}
