import type { AsyncFunctionInvokePort } from './async-function-invoke.port.ts';
import type { Logger } from './create-logger.ts';

// Slice 4 D7, D23: local mode's asynchronous invoke: the composed function, started in process and
// not awaited (locally, the reconciler's `runClaimed`). A rejection is logged by name and never
// rethrown, as an `Event` invoke's function error never reaches its caller.
export class InProcessAsyncFunctionInvokeAdapter implements AsyncFunctionInvokePort {
  readonly #fn: (payload: unknown) => Promise<unknown>;
  readonly #logger: Logger;

  constructor(fn: (payload: unknown) => Promise<unknown>, logger: Logger) {
    this.#fn = fn;
    this.#logger = logger;
  }

  async invokeAsync(payload: unknown): Promise<void> {
    // Started on a later turn, so the caller resumes first, as it would after a `202`; a function
    // that throws before its first await is caught like one that rejects.
    void Promise.resolve()
      .then(() => this.#fn(payload))
      .catch((error: unknown) => {
        this.#logger.error('invoke.async_failed', {
          error_name: error instanceof Error ? error.name : 'unknown',
        });
      });
  }
}
