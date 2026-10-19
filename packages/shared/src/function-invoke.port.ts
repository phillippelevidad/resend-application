// D1: a synchronous call to another function, bound to one function: `invoke` awaits its result
// (the API → the worker's resume). On AWS, a `RequestResponse` invoke (`packages/aws`); locally, the
// composed factory called in process. It rejects when the function fails. The asynchronous invoke
// is slices 4 and 6's.
export interface FunctionInvokePort {
  invoke(payload: unknown): Promise<unknown>;
}
