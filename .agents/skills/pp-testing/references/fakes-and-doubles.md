# Fakes and test doubles

**Fake at the port, never below it.** A fake implements a named port in `packages/shared` or the
client type `resend-client` exports (ADR-012's seam); everything else runs for real
([adding-things.md → Add an interface](../../pp-general/references/adding-things.md#add-an-interface)).
A test double is not a second implementation, and a mocked database client never counts as the
integration tier ([Test tiers](../../pp-workflow/SKILL.md#test-tiers)). The port set and its shapes
are [pp-backend → Ports](../../pp-backend/references/composition.md#ports)'s.

## Which double, per seam

| Seam | In a test | Never |
| --- | --- | --- |
| Queue port | The in-process queue: the real slice 1 implementation, not a fake (ADR-013). For ingest's `503`, a queue double whose `enqueue` rejects | A recorded-call stub asserting "enqueue was called" |
| Clock port, and the limiter's injected sleep | The fake clock from `@ledger/shared/testing`: `now()` returns a set instant, `advance(ms)` moves it, and a sleep through it resolves when the clock passes its deadline | `vi.useFakeTimers()` or `Date.now` patched for logic under test |
| `resend-client`'s consumers (reconciler, dispatcher) | A fake client from `@ledger/resend-client/testing`, typed against the exported client, holding programmable answers and recording what it was asked | `vi.mock('resend')` |
| `resend-client` itself | The [fake Resend API](#the-fake-resend-api): a local `node:http` server | `nock`, `msw`, a patched `fetch` |
| A `packages/aws` adapter | Its [port contract](#aws-adapters) with the SDK client stubbed | An SQS fake in a consumer's test |
| Postgres | The [harness](postgres-harness.md): real Postgres | A mocked client, a stubbed repository |
| Logger | The real logger, its output captured: `createLogger({ functionName, stream })` with a sink (`{ write: (chunk) => lines.push(chunk) }`) gets the same format and allow-list over a Winston Stream transport, one JSON line per call ([logging-and-pii.md](../../pp-general/references/logging-and-pii.md#logger), D15) | Asserting the logger was called; assert the line |
| Event source control, queue attributes, function invoke, DLQ, secret reading ([ports](../../pp-backend/references/composition.md#ports)) | A stateful fake from `@ledger/shared/testing` holding what the port reads and writes; the test asserts the resulting state (`state: 'paused'` after an outage). Slice 2's four: `FakeEventSourceControl` (`state`; `failGetState`, `failEnable`, `failDisable`), `FakeQueueAttributes` (`snapshot`, `failing`), `FakeFunctionInvoke` (the scripted `answer`, `failing`, the `payloads` it was sent), `FakeSecretReader` (`secrets` by id, `failing`, `reads`). Slice 4 adds `FakeAsyncFunctionInvoke` (the `payloads` handed over; `failNext()` rejects the next invoke). A failing fake rejects with a plain `FakeFailure` error carrying no registry code, as an SDK failure would. The DLQ fake is slice 3's | A recorded-call stub asserting "disable was called" |
| SDK, for CLI and MCP tests | A fake SDK ([pp-cli](../../pp-cli/SKILL.md#output-and-exit-codes), [pp-mcp](../../pp-mcp/SKILL.md#tool-registration-and-least-privilege)) | The database |

- A fake lives in the `testing.ts` surface of the package that owns the port or the client, named
  as the thing it is (`fake-clock.ts` → `FakeClock`, no role suffix,
  [file names](../../pp-general/references/coding-standards.md#file-names)). It is exported only when
  a test outside the package imports it in the same diff.
- A fake has no logic the real implementation lacks. If a test needs a fake to "decide" something,
  the decision belongs in the code under test.

## The fake Resend API

`resend-client`'s own tests, and every claim that crosses its limiter, run the **real** client
against a local HTTP server standing in for Resend's API.

- **How it is pointed there.** The `resend` SDK's constructor is
  `constructor(key?: string, options?: ResendOptions)`, with `ResendOptions { baseUrl?: string;
  userAgent?: string }`, and it requests `` `${this.baseUrl}${path}` `` through global `fetch`
  (verified in the `resend@6.33.0` `.d.mts` and `.mjs` on npm, the version RS-02 pins). Without the
  option, the SDK reads `process.env.RESEND_BASE_URL`, then `https://api.resend.com`. So
  `resend-client` MUST pass `baseUrl` from its typed config, never leave it to the environment, and
  a test passes the fake's URL (no trailing slash). Re-check against the version slice 4 installs.
- **The server** is `node:http` on `127.0.0.1`, port `0` (the OS picks), closed in `afterAll`,
  exported from `@ledger/resend-client/testing`. It answers the routes the client's named methods
  call (List Events, Retrieve Webhook and Replay Event from slice 4; Send Email from the slice whose test first calls it), from a scripted
  queue of responses: status, the RS-22 error body `{ name, statusCode, message }`, and the
  `ratelimit-*` and `retry-after` headers.
- **It records what it received**: method, path, the `User-Agent` and `Idempotency-Key` headers,
  the body. The outbound request is the consequence at this seam (RS-21, RS-24).
- **Which claims use it:** the limiter unit tests (ADR-012); the slice 4 fake-API integration tests
  (outage past the retry schedule, the 5-day gap, the disabled webhook, the `429` storm with
  `retry-after`), which compose the real reconciler, the real `resend-client` and this server
  ([slice 4](../../../../.ai/build-checklist.md#4--recovery)). A fake client there would skip the
  limiter the `429` claim is about.
- A fixture body copies a payload from [resend.md](../../../../.ai/resend.md) with test addresses
  only, never a captured live response.

## AWS adapters

A `packages/aws` adapter is the outermost seam: its own dependency is the AWS SDK client.

- The adapter takes its SDK client from the composition root, so a test hands it a stub: a
  hand-written object with `send(command)` that records each command and answers from a script
  (no `aws-sdk-client-mock`: a few lines, and a dependency is Ask-first).
- The test asserts the commands sent (name and `input`), which are the consequence at this seam,
  and that each scripted answer maps to the port's result or the right registry error.
- **A scripted error carries the name the operation's AWS API Reference page lists**, cited in the
  test, never one the author guesses. Where the page does not say which error a condition raises
  (AWS-21's one active task per queue), the stub cannot prove the mapping: the slice's walk triggers
  it once on the deployed stack and records the observed name beside the test.
- When a second implementation of the port exists, the adapter also runs the port's
  [shared contract suite](vitest-layout.md#shared-contract-suites), its `make` building the adapter
  over the stubbed client (slice 2: all five of `packages/aws`'s port adapters).
- These are `*.test.ts`: no Postgres, no Docker.

**As built (slice 2).** The stub is `StubClient` in `packages/aws/src/testing/stub-client.ts`,
used only by that package's own tests (no `./testing` export):

- `answer(name, fn)` scripts one command by its operation name (`'SendMessage'`, the SDK class name
  less `Command`); `fn` gets the command's `input` and returns the output or throws. An unscripted
  command fails the test. `stub.as<SQSClient>()` hands it to the module as its client type.
- `sent` (name and `input`, in order), `names()` and `inputs(name)` are what the test asserts.
- A scripted error is the SDK's own exception class, built as the SDK builds it
  (`new QueueDoesNotExist({ message, $metadata: {} })`), so its `name` is the one the API Reference
  lists; the test file's header cites that page.
- An adapter rejects with the SDK's error unchanged (its `name` is what a consumer logs as
  `error_name`), and throws a constant `LedgerError('internal_error', …)` only for a condition it
  detects itself (no mapping, a `FunctionError`, a non-JSON payload, a missing attribute). Each test
  covers both kinds.
- A test whose subject spans several clients or holds state across calls (the kill switch) scripts
  the stubs over one small account state and wraps each `send` to append to one shared log, so it
  asserts both the order of commands across services and the state they leave.

## DLQ redrive

Redrive runs through SQS, not Postgres (`StartMessageMoveTask`, AWS-21). `DlqPort` has two
implementations, `SqsDlqAdapter` and the in-process queue's dead list, and both run
`dlqPortContract` ([Shared contract suites](vitest-layout.md#shared-contract-suites); slice 3, D3):
the SQS side from `sqs-dlq.adapter.test.ts`, its `deadLetter` seeding the stubbed DLQ; the
in-process side from `in-process-queue.adapter.test.ts`, its `deadLetter` failing the message
through every receive. Its evidence:

1. **The adapter against the port contract** (slice 3):
   [`sqs-dlq.adapter.test.ts`](../../../../packages/aws/src/sqs-dlq.adapter.test.ts), over a stubbed
   SQS client that holds a small DLQ (its visible messages, the ones a receive hid, its move tasks;
   a receive with a visibility timeout above 0 hides what it returns, and a start empties the DLQ).
   It asserts the request and what it leaves: `ReceiveMessage` with `VisibilityTimeout: 0`,
   `WaitTimeSeconds: 1` and `MaxNumberOfMessages: limit`, and never `DeleteMessage` (AWS-59); a
   second sample still sees every message; a `RUNNING` task from `ListMessageMoveTasks` answers
   `redrive_in_progress` ([Error codes](../../../../.ai/api-contract.md#error-codes)) with no start
   sent, while `COMPLETED`, `CANCELLED`, `FAILED` and `CANCELLING` do not refuse; whatever the depth
   reads, a confirming receive (`MaxNumberOfMessages: 1`, visibility 0, `WaitTimeSeconds: 1`) that
   returns nothing answers `empty` with no start, and a depth of 0 beside a received message starts
   the task and answers `depth` 1 (AWS-62; the stale-depth lag measured on the deployed stack, F3's
   branch `[Unverified]`); otherwise `StartMessageMoveTask` with the DLQ's `SourceArn` and no
   `DestinationArn`, and no `TaskHandle` in the result (AWS-61); a scripted start error (each name
   the API Reference lists) propagates unchanged with no second start, because "one active task per
   queue" (AWS-21) has no named error (AWS-U14). The status and error names are cited from the API
   Reference in the file's header. Removing `VisibilityTimeout: 0`, the `RUNNING` check, the empty
   check or the confirming receive fails a case.
2. **The simulator invariant** (slice 3): the poison run passes invariant 4, and a redrive after the
   fix returns the DLQ depth to 0 ([slice 3](../../../../.ai/build-checklist.md#3--operations-and-evidence-on-aws)).
3. **What does run through Postgres:** a redriven message gets a new `messageId` but keeps its
   `svix_id` (AWS-21), so the worker's duplicate-delivery integration test feeds the same `svix_id`
   under a changed transport id; and local mode's redrive (slice 2B) clears `dead_at` on
   `local_queue_messages`, an `*.int.test.ts`.

## Assert the consequence

Assert what the change leaves in the world: the row, the effect at a receiver, the response, the
emitted log line. A test that checks "the repository was called with X" passes while the row is
wrong. The one exception is the **outbound vendor seam**: for the fake Resend API and an AWS
adapter's stubbed client, the request sent is the consequence, so assert its content.
