import type { AsyncFunctionInvokePort } from '../async-function-invoke.port.ts';
import { fakeFailure } from './fake-failure.ts';

// Slice 4 D7: the asynchronous invoke's fake. It records every payload handed over, the consequence
// a test reads; `failNext()` makes the next invoke reject, as a refused hand-off would.
export class FakeAsyncFunctionInvoke implements AsyncFunctionInvokePort {
  readonly payloads: unknown[] = [];
  #failNext = false;

  failNext(): void {
    this.#failNext = true;
  }

  async invokeAsync(payload: unknown): Promise<void> {
    if (this.#failNext) {
      this.#failNext = false;
      throw fakeFailure('FakeAsyncFunctionInvoke.invokeAsync');
    }
    this.payloads.push(payload);
  }
}
