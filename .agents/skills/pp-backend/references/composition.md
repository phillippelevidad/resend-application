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
pool. A container therefore processes its messages one at a time. The pool sets
`connectionTimeoutMillis` and `query_timeout` below the function timeout, so a hung database
surfaces as a classified connection error (ADR-015), not a Lambda timeout that fails the batch
(AWS-05) without pausing the ESM ([pp-database → Connection](../../pp-database/references/schema-and-repositories.md#connection));
the values are the slice 2 pre-proposal's.

`apps/<fn>/src/<fn>.handler.ts` exports `handler`, the CDK entry ([pp-infra](../../pp-infra/SKILL.md)).
It adapts the event (decodes the body per AWS-01, maps SQS records, builds the
`batchItemFailures` response per AWS-05), sets the per-invocation log fields (`request_id` from
`awsRequestId`, `cold_start`; [logger](../../pp-general/references/logging-and-pii.md#logger)) and
calls the function `main.ts` built. It holds no logic: a branch on domain data in a handler belongs
in the package.

`apps/local/src/main.ts` composes the same factories with local adapters (the in-process queue,
`@hono/node-server`, from slice 2B the Postgres queue), so no app imports another (ADR-013). It
gives each function it composes that touches the database its own size-1 pool (ingest has none,
ADR-001), so a dispatcher batch holding its connection across sends never blocks the worker or the
read API.

**The ingest mount.** One `fetch` serves the process: `POST /webhooks/resend` goes to
`ingestFetch(ingest)` (`apps/local/src/ingest-fetch.ts`), every other method and path to the read
API's `api.fetch`, mirroring the HTTP API's routes on AWS. `ingestFetch` is event adaptation only:
it reads the request body as bytes decoded as UTF-8 (the signature covers the exact body, RS-01),
passes the three lowercase `svix-*` headers, and returns ingest's status and fixed body under
`@ledger/ingest`'s `INGEST_CONTENT_TYPE` ([Ingest boundary](../../../../.ai/api-contract.md#ingest-boundary)). The
read API never mounts ingest, so an unmatched path, `GET /webhooks/resend` included, answers
`404 route_not_found` from the API's `notFound`.

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
| Event source control (read state, enable, disable the worker ESM; AWS-18): `EventSourceControlPort`, `getState(): Promise<EventSourceState>`, `enable()`, `disable()` | `LambdaEventSourceControlAdapter` in `packages/aws`, bound to one function name; local mode's `StaticEventSourceControlAdapter` in `packages/shared` reports `enabled`, enable and disable no-ops ([worker.resumeEventSource](../../../../.ai/api-contract.md#workerresumeeventsource)) | 2 |
| Queue attributes (depth, oldest age; AWS-22): `QueueAttributesPort`, `read(): Promise<QueueSnapshot>`, `QueueSnapshot = { visible, inFlight, oldestAgeSeconds: number \| null, dlqVisible, dlqInFlight }` | `SqsQueueAttributesAdapter` in `packages/aws`; locally `InProcessQueueAdapter` counts its own lists (waiting `visible`, delivering `inFlight`, the dead list `dlqVisible`, age from the oldest `enqueuedAt`; slice 2, D40); slice 2B's Postgres-backed queue counts `local_queue_messages` | 2 |
| Function invoke (async: worker → dispatcher, API → reconciler; synchronous, awaiting the result: API → worker resume, whose answer is the resulting state or `database_unavailable`). The synchronous one is `FunctionInvokePort`, `invoke(payload: unknown): Promise<unknown>`, bound to one function; the async one is slices 4 and 6's | `LambdaFunctionInvokeAdapter` in `packages/aws` (`RequestResponse`); locally `apps/local` calls the composed factory in process (async: not awaited, a rejection logged; synchronous: awaited, through `InProcessFunctionInvokeAdapter` in `packages/shared`) | 2 |
| DLQ receive and redrive (AWS-50, AWS-21): `DlqPort`, `sample(limit): Promise<DlqSample>` (never deletes or hides a message), `startRedrive(): Promise<RedriveStart>` (throws `redrive_in_progress`), `DlqSample = { depth, messages: { body, receiveCount }[] }` with raw bodies (the reader parses them), `RedriveStart = { status: 'started', depth } \| { status: 'empty', depth: 0 }`; `depth` is visible plus in flight (slice 3, D1) | `SqsDlqAdapter` in `packages/aws` (slice 3, D4); locally `InProcessQueueAdapter` over its dead list: `sample` returns its first `limit` entries and removes none, `depth` its length; `startRedrive` moves every entry back to the waiting list with its receive count reset, under a new message id, and answers `started` with the count or `empty`, never `redrive_in_progress` (slice 3, D3); slice 2B's Postgres-backed queue reads and clears `dead_at` | 3 |
| Secret reading (Secrets Manager, by the ARN in an internal variable; [secrets](../../pp-general/references/config-and-env.md#secrets)): `SecretReaderPort`, `read(secretId: string): Promise<string>` | `SecretsManagerSecretReaderAdapter` in `packages/aws`; locally `apps/local`'s `main.ts` passes `StaticSecretReaderAdapter` (`packages/shared`) over the values its config parsed from `.env.local`, so the factory always takes the port. It answers one value for the one id it was built with and rejects any other | 2 |

ADR-013 lists Secrets Manager among `packages/aws`'s adapters without naming its port; ingest needs
the secret set on AWS without importing `@aws-sdk/*`, so it reaches it through a port like the
others. Each port's exact name and methods are settled by the slice that lands it; the table fixes
which ports exist. A port that is not in this table needs an ADR that names it
([pp-general → Case-by-case](../../pp-general/SKILL.md#case-by-case)). Every port with two
implementations has one shared contract suite that both run
([pp-testing → Shared contract suites](../../pp-testing/references/vitest-layout.md#shared-contract-suites)).

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
