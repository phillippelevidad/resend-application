# Factories, composition roots and ports

How a function's logic is built once and reached from a Lambda event or a local process. The
decision is [ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode) (logic in
packages, apps as entry points, ports in `packages/shared`) and
[ADR-019](../../../../.ai/architecture.md#adr-019--application-and-surface-stack) (hand-wired roots,
no container). Where a file goes and what it is called are pp-general's
([boundaries.md](../../pp-general/references/boundaries.md#where-does-this-code-go),
[role suffixes](../../pp-general/references/coding-standards.md#role-suffixes)).

## The factory

Each logic package (`ingest`, `worker`, `dispatcher`, `reconciler`, `api`) exports one factory,
`create<Thing>(deps)`:

- **It takes ports and typed config, nothing else.** `deps` holds the port implementations, the
  repositories' database handle, the logger, the clock and a config object the root already parsed
  ([config-and-env.md](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)).
- **It returns a function over domain inputs, never over a Lambda event.** Ingest takes the raw
  body and the headers it needs; the worker takes a list of `{ messageId, body }`. When one Lambda
  serves two event kinds (the worker's SQS batch and its resume event, ADR-015), the factory returns
  an object of functions, one per kind.
- **Packages import no Lambda event type** (`aws-lambda`, [review grep 8](../../pp-general/references/boundaries.md#review-greps)).
  The `api` factory returns the Hono app object, which `@hono/aws-lambda` and `@hono/node-server`
  both serve ([read-api.md](read-api.md)).

```ts
// packages/worker/src/create-worker.ts — the shape, not an API
export type WorkerDeps = { db: Database; queue: QueuePort; clock: ClockPort; logger: Logger; config: WorkerConfig };
export function createWorker(deps: WorkerDeps) {
  return {
    processBatch: (messages: readonly QueueMessage[]) => /* … */,
    resume: () => /* ADR-015 probe and re-enable */,
  };
}
```

## The composition root

Each `apps/<fn>/src/main.ts` is the one place that:

1. parses `process.env` with its `<fn>.config.ts` schema (pp-general);
2. builds the logger, the one `pg` pool, the repositories' handle and each adapter;
3. calls the factory and exports what it returns.

All of it runs **at module scope**, so a warm invocation reuses the pool, the adapters and any
per-container cache (the ingest secret-set TTL, ADR-009). The pool is **size 1 per function
container** ([ADR-005](../../../../.ai/architecture.md#adr-005--postgres-only),
[integrations.md → How it is used](../../../../.ai/integrations.md#decision--neon)); concurrency
comes from more containers, capped by the ESM `MaximumConcurrency` (ADR-008), never from a bigger
pool. A container therefore processes its messages one at a time.

`apps/<fn>/src/<fn>.handler.ts` exports `handler`, the CDK entry ([pp-infra](../../pp-infra/SKILL.md)).
It adapts the event (decodes the body per AWS-01, maps SQS records, builds the
`batchItemFailures` response per AWS-05), sets the per-invocation log fields (`request_id` from
`awsRequestId`, `cold_start`; [logger](../../pp-general/references/logging-and-pii.md#logger)) and
calls the function `main.ts` built. It holds no logic: a branch on domain data in a handler belongs
in the package.

`apps/local/src/main.ts` composes the same factories with local adapters (the in-process queue,
`@hono/node-server`, from slice 2B the Postgres queue), so no app imports another (ADR-013). How it
mounts `POST /webhooks/resend` beside the read API is the slice 1 pre-proposal's.

## Ports

A port is an interface in `packages/shared/src/<name>.port.ts`, named for its capability plus
`Port`. Its implementations are `.adapter.ts` files in the package that owns the I/O. A port is the
one sanctioned single-implementation-per-runtime interface; a test double is not a second
implementation ([adding-things.md](../../pp-general/references/adding-things.md#add-an-interface)).

| Port | Implementations | Lands |
| --- | --- | --- |
| Queue (`enqueue`, and the receive and settle a local consumer needs) | in-process (slice 1), SQS in `packages/aws` (slice 2), Postgres-backed in `packages/db` (slice 2B) | 1 |
| Clock (`now()`) | system clock; tests use a fake that implements the port (ADR-009's TTL test) | 1 |
| Metrics helper's interface (the fixed EMF set, [metrics](../../pp-general/references/logging-and-pii.md#metrics)) | the EMF line writer; locally, through the logger | 1 |
| Event source control (read state, enable, disable the worker ESM; AWS-18) | `packages/aws`; local mode reports the state as a no-op ([worker.resumeEventSource](../../../../.ai/api-contract.md#workerresumeeventsource)) | 2 |
| Queue attributes (depth, oldest age; AWS-22) | `packages/aws`; local mode counts `local_queue_messages` | 2 |
| Function invoke (async: worker → dispatcher, API → reconciler; synchronous, awaiting the result: API → worker resume, whose answer is the resulting state or `database_unavailable`) | `packages/aws` | 2 |
| DLQ receive and redrive (AWS-50, AWS-21) | `packages/aws`; local mode reads and clears `dead_at` | 3 |
| Secret reading (Secrets Manager, by the ARN in an internal variable; [secrets](../../pp-general/references/config-and-env.md#secrets)) | `packages/aws`; locally `apps/local`'s `main.ts` passes a static implementation over the values its config parsed from `.env.local`, so the factory always takes the port | 2 |

ADR-013 lists Secrets Manager among `packages/aws`'s adapters without naming its port; ingest needs
the secret set on AWS without importing `@aws-sdk/*`, so it reaches it through a port like the
others. Each port's exact name and methods are settled by the slice that lands it; the table fixes
which ports exist. A port that is not in this table needs an ADR that names it
([pp-general → Case-by-case](../../pp-general/SKILL.md#case-by-case)).

**`resend-client` is not a port.** It is ADR-012's named seam: a package that exports the client
its consumers type against ([resend-client.md](resend-client.md)). Nothing in `packages/shared`
declares a Resend interface.

## Never

- **A factory taking `process.env`, an `APIGatewayProxyEventV2` or an `SQSEvent`** → typed config
  and a domain input, adapted in the handler.
- **Building the pool, a client or an adapter inside the handler function** → module scope in
  `main.ts`, built once per container.
- **A pool larger than 1, or a second pool in one function** → one size-1 pool; scale by containers.
- **A module-level singleton imported by a package** → passed in through `deps` from `main.ts`
  ([rejected patterns](../../pp-general/references/adding-things.md#rejected-patterns)).
