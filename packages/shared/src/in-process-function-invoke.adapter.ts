import type { FunctionInvokePort } from './function-invoke.port.ts';

// D1, D40: local mode's synchronous invoke: the composed factory's function, called in process and
// awaited (locally, the worker's `resume`). Its rejection is the invoke's, as a function error is on
// Lambda.
export class InProcessFunctionInvokeAdapter implements FunctionInvokePort {
  readonly #fn: (payload: unknown) => Promise<unknown>;

  constructor(fn: (payload: unknown) => Promise<unknown>) {
    this.#fn = fn;
  }

  // `async`, so a function that throws before its first await still rejects rather than throws.
  async invoke(payload: unknown): Promise<unknown> {
    return this.#fn(payload);
  }
}
