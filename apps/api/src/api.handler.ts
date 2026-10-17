// Stub until slice 2 (D35): `createApi(deps)` now needs a database, a logger and the address-hash
// key, which this Lambda gets only from slice 2's composition root (secrets, size-1 pool). Slice 2
// serves the same app here through @hono/aws-lambda (ADR-010, ADR-019); infra references no
// function that points at this file until then.
export {};
