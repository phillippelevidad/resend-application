import type { FunctionInvokePort } from '../function-invoke.port.ts';
import { fakeFailure } from './fake-failure.ts';

// D1: the synchronous invoke's stateful fake. It holds the scripted `answer` the invoked function
// returns, whether the invoke fails, and every payload it was sent: the payload is what crosses to
// the other function, so it is the consequence a test reads.
export class FakeFunctionInvoke implements FunctionInvokePort {
  answer: unknown;
  failing = false;
  readonly payloads: unknown[] = [];

  constructor(answer?: unknown) {
    this.answer = answer;
  }

  async invoke(payload: unknown): Promise<unknown> {
    this.payloads.push(payload);
    if (this.failing) throw fakeFailure('FakeFunctionInvoke.invoke');
    return this.answer;
  }
}
