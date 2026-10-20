// Slice 4 D7: an asynchronous call to another function, bound to one function: `invokeAsync`
// resolves once the payload is handed over, never with the function's result, and a function that
// fails never rejects it (the read API → the reconciler's manual run). On AWS, an `Event` invoke
// (`packages/aws`); locally, the composed function called in process and not awaited.
export interface AsyncFunctionInvokePort {
  invokeAsync(payload: unknown): Promise<void>;
}
