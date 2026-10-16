# pp-* skills architecture review 2026-10-16: decisions

Five reviewers (A1 pp-workflow + pp-general, A2 pp-backend, A3 pp-database, A4 pp-testing +
pp-infra, A5 pp-cli + pp-mcp) through the `architecture-designer` lens: 56 findings, 0 BLOCK.
Every fix was verified against its cited text by a second agent before it was applied. A historical
record, not binding: the fixes live in the skills and docs.

## Applied: low stakes, settled by the docs

| ID | Skill | Fix |
| --- | --- | --- |
| A1-01 | pp-workflow (+ wf-after-apply-check mirrors) | Mandatory tier gains the worker failure path: exact `batchItemFailures` (ADR-008) and the outage pause (ADR-015) |
| A1-02 | pp-workflow (+ mirrors) | Tier row and Mandatory item for the synthesized stack: one `Template` assertion per cost-brake property |
| A1-06 | pp-workflow | A claim matching several tier rows owes each |
| A1-07 | pp-general | Secret contents read at runtime are Zod-parsed before first use |
| A1-09 | pp-general | No error leaves a Lambda handler as thrown: caught at the edge, logged by allow-listed fields, rethrown constant |
| A1-10 | pp-general | The log allow-list keeps only primitives under an allowed key |
| A1-11 | pp-general | A code with no registry status reaching `onError` is `500 internal_error` |
| A2-01 | pp-backend | The dispatcher records each row's failure in the batch, never rethrows; checks the 24 h horizon and the remaining time per send |
| A2-02 + A3-02 | pp-backend, pp-database | The pool sets `connectionTimeoutMillis` and `query_timeout`, so a hung database is classified (ADR-015) |
| A2-03 | pp-backend | A rule fires on the transition the event causes (ADR-006 "becomes true"), computed from the event set |
| A2-04 | pp-backend | A failed secret-set read is a `5xx`, never a `401` |
| A2-05 | pp-backend | The dispatcher is invoked at most once per batch; an invoke failure never fails a committed message |
| A2-07 | pp-backend | Quota `429`s and a `429` without `retry-after` are not retried |
| A2-08 | pp-backend | Pool size 1 is per Lambda function; `apps/local` gives each composed function its own |
| A2-09 | pp-backend | The function-invoke port names its local implementation |
| A3-01 | pp-database | The classifier drops pg-pool's full-pool timeout (a bug, ADR-008, not an outage) |
| A3-03 | pp-database | A `pool.on('error')` listener is required |
| A3-04 | pp-database | The migrate connection sets `lock_timeout`; the session-SQL ban is scoped to the pooled URL |
| A3-05 | pp-database | The creating inserts follow the lock order too (deadlock) |
| A3-09 | pp-database | A constraint on an existing column is a two-deploy change |
| A3-11 | pp-database | A locking function takes the transaction type, never `Executor` |
| A4-01 | pp-testing | The queue-port contract asserts at-least-once (AWS-06) |
| A4-02 | pp-testing | A concurrent-duplicate integration test |
| A4-03 | pp-testing | The int tier does not exercise the pooler topology; says where pooler safety is proven |
| A4-04 | pp-testing | Arbitraries generate sort-key ties (ADR-003 tie-breaks) |
| A4-05 | pp-testing | Simulator ids are namespaced per run (ADR-016 "fresh `svix_id`s") |
| A4-07 | pp-testing | A scripted AWS error cites its API Reference name, or the walk observes it |
| A4-08 | pp-testing | The five unlisted ports get a stateful-fake row |
| A4-09 | pp-infra (+ aws.md row) | The kill switch's ESM and HTTP API permissions, which have no prefixed ARN |
| A4-10 | pp-infra (+ aws.md) | Teardown destroys the guardrails stack only after the app stack's destroy succeeds |
| A4-14 | pp-infra | Deploy step 8 (restore a pause) runs even when step 5 failed |
| A5-01 | pp-cli | The SDK client is built outside the `try`, so a config error exits `2` |
| A5-03 | pp-mcp, pp-backend sdk.md | The startup scope read is retried (every read is, per Conventions) |
| A5-04 | pp-mcp | A stdout test proves the JSON-RPC channel stays clean |
| A5-05 | pp-backend sdk.md | A per-request timeout just above the HTTP API's 30 s cap |
| A5-06 | pp-cli | `ledger reconcile` prints the run id to stderr in both modes |
| A5-07 | pp-mcp | One constant stderr line when `--enable-operate` meets a `read` token |

## Applied under the decision lens (reported to the owner)

| ID | Clause | Fix |
| --- | --- | --- |
| A1-03 | 6 — PII exposure | A route-level redaction test for every read-API route whose mapper reads `webhook_events` or a queue envelope, landing with the route (slices 1 and 3), not only the slice 5 MCP test |
| A1-04 | 6 — security; evidence rule | The loopback-only auth skip carries a unit test: the local server refuses a non-loopback bind |
| A1-12 | 1 — a step that recurs per review MUST be scripted | The boundary greps Biome cannot express run as one `pnpm verify` stage (slice 0 scope) |

Resolved without a change: **A1-13** (slice 1 must name the address-hash key and the local
signing-secret variables, an Ask-first contract addition): the slice 1 pre-proposal is the gate
built for it, so the plan already carries it.

## Owner decisions

See [PROGRESS.md → Owner checkpoint](PROGRESS.md#owner-checkpoint).
