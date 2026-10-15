# Integrations

Ledger has one vendor (Resend) and one database (Postgres). Part 1 is the discipline for every call
Ledger makes to Resend, and Ledger's relationship to Resend's Webhook Ingester. Part 2 is the
Postgres host decision. Research current as of **2026-10-15**. Resend behavior cites `RS-NN`
([resend.md](resend.md)), AWS behavior cites `AWS-NN` ([aws.md](aws.md)), and vendor pages are
cited inline with the date they were read.

**Code:** `packages/resend-client` (Part 1) · `packages/db` and `infra/` (Part 2) · **Env:**
`RESEND_API_KEY`, `DATABASE_URL` (local `.env.local` only; deployed values come from Secrets
Manager, [Secrets layout](#secrets-layout))

## Part 1 — Resend discipline

### Locked rules (MUST)

1. **One caller.** Every call to Resend's API goes through `packages/resend-client`
   ([module boundaries](../AGENTS.md#module-boundaries)). No other package imports the `resend`
   SDK for API calls. Signature verification in `apps/ingest` is local crypto, not an API call
   (RS-01, RS-02).
2. **One budget, with headroom.** The 10 req/s limit is per team and shared by every key (RS-19),
   and observed live to be shared across endpoints (RS-20). The client owns one limiter: default
   **2 req/s**, configurable. It also yields when `ratelimit-remaining` falls below half of
   `ratelimit-limit`, and on `429` it waits `retry-after` (RS-19). The reconciler, the dispatcher
   and any CLI-triggered call share it. *Why 2:* Ledger is a background consumer of the team's
   budget. At 2 req/s, recovering a 10,000-event gap (100 List Events pages plus 10,000 replays,
   RS-14, RS-16) takes ≈ 85 min, which is acceptable for recovery work. Evidence: limiter unit
   tests (rate, yield on low `remaining`, `retry-after` on `429`) · *recovery · M1*.
3. **Default reconcile cadence: hourly** (owner, 2026-10-15). Resend's own retries cover the first
   ≈ 27.6 h (RS-09), so the cadence sets only how quickly loss is detected. It is also the
   database wake budget ([Postgres host → Cadence](#cadence-and-the-database)). A run has a time
   budget below the Lambda timeout (AWS-03). The next run re-diffs from newest, so progress is kept
   by the ledger itself (forward-only pagination, [resend.md → Constraint 13](resend.md#constraints-and-sharp-edges)).
   Runs MUST NOT overlap.
4. **Check every response; never trust a throw.** The SDK never throws on HTTP errors and never
   retries (RS-23). Errors are mapped by HTTP status first, then by name, with a default branch
   (RS-22, [resend.md → Constraint 14](resend.md#constraints-and-sharp-edges)). Every request
   carries a `User-Agent` (RS-21). The SDK sends one, and a raw `fetch` MUST set it.
5. **Read webhook status before any replay.** A disabled webhook stops delivery (RS-11). The
   reconciler stops with `webhook_disabled` and a re-enable hint
   ([resend.md → Constraint 2](resend.md#constraints-and-sharp-edges)).
6. **Idempotent writes where Resend allows them.** Every send carries an `Idempotency-Key`
   derived from the outbox `dedupe_key` (RS-24). Keys live 24 h, so the alert-email retry horizon
   stays under 24 h ([resend.md → Constraint 8](resend.md#constraints-and-sharp-edges)). Replays
   take no key (RS-17): their safety rests on ledger dedupe on `svix_id` and on RS-U01.
7. **Secrets never leave Secrets Manager.** Any `full_access` key can read the signing secret
   (RS-05), and no read-only key exists (RS-18). Keys and signing secrets never appear in logs, CLI
   output, MCP output or Resend-visible response bodies
   ([resend.md → Constraint 11](resend.md#constraints-and-sharp-edges)).
8. **Writes against a live account are Ask-first**: replay, rotate secret, create or update a
   webhook, send email, and every `resend webhooks listen` session (RS-33)
   ([Permissions](../AGENTS.md#permissions)). Tests use a fake Resend API.
9. **Verify, don't assume.** Code relies on a Resend behavior only once it is an `RS-NN` fact.
   Otherwise it is an `RS-UNN` row, and the code tolerates both outcomes until the owing slice
   settles it ([resend.md → \[Unverified\]](resend.md#unverified)).
10. **Fixtures use Resend's test addresses** (`delivered@resend.dev`, `bounced@resend.dev`, …,
    RS-32). Never a real recipient.

### Secrets layout

Least privilege per caller, decided by the owner on 2026-10-15
([resend.md → Constraint 10](resend.md#constraints-and-sharp-edges)). One secret per trust
boundary, each USD 0.40/month (AWS-11):

| Secret | Holds | Read by | From |
| --- | --- | --- | --- |
| `ledger/webhook-signing-secrets` | The configured set of `whsec_` secrets (a JSON array, so rotation adds one before retiring one, RS-04) | `apps/ingest` only | M1 |
| `ledger/resend-api-key` | A `full_access` key, the only kind the Headless Webhook API accepts (RS-18) | `apps/reconciler` only | M1 |
| `ledger/database-url` | The pooled Postgres connection string ([Decision](#decision--neon)) | worker, dispatcher, reconciler, read API | M1 |
| `ledger/resend-sending-key` | A `sending_access` key, optionally scoped to one domain with `domain_id` (RS-18) | `apps/dispatcher` only | *reactions · M2* |

That is USD 1.20/month in M1 and 1.60 from M2 ([aws.md → Cost shape](aws.md#cost-shape)). Secret
names are prefixed per stack, and each Lambda receives only the ARNs of the secrets it reads, with
IAM read access to those alone. The dispatcher never holds the `full_access` key: a dispatcher
leak can send email, but cannot read the signing secret or touch webhooks (RS-05).

### Relationship to the Webhook Ingester

Resend's [Webhook Ingester](https://github.com/resend/resend-webhooks-ingester), re-checked
2026-10-15 at `main` @ `41dda70` (2026-05-27, unchanged since [features.md](features.md#ingester-parity-reference-non-binding)
pinned it). It is a Next.js app that verifies Svix signatures and appends each event to one of 9
database connectors, deduplicated on a unique `svix_id`. It writes synchronously in the request
(`500` on failure, so Resend retries), keeps no queue, derives no state and recovers nothing on
`main` ([README](https://github.com/resend/resend-webhooks-ingester);
[docs](https://resend.com/docs/webhooks/ingester), both read 2026-10-15).

- **Complement, don't duplicate.** Ledger MUST NOT rebuild what the Ingester already does well for
  its own sake (multi-database connectors, warehouse loading). Ledger builds what it lacks:
  queue-buffered ingest, order-independent state, outbox reactions, DLQ + redrive, CLI / SDK / MCP
  ([about.md → Positioning](about.md#positioning)). Parity detail lives in
  [features.md](features.md#ingester-parity-reference-non-binding).
- **No license.** As of 2026-10-15 the GitHub API reports `"license": null`, and the tree has no
  license file, although Resend's docs call it "open-source". Its code MUST NOT be copied, vendored
  or adapted into Ledger. Read it for behavior, and write Ledger's own code. Re-check before citing
  this rule as current.
- **PR #13 is prior art, cited, not claimed.** [PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13)
  (open, unreviewed, closes [#12](https://github.com/resend/resend-webhooks-ingester/issues/12)) adds a
  Postgres-only `/reconcile`: page List Events newest first, skip events younger than 10 min, stop
  at 3 days, and replay every id missing from storage, under 10 req/s. Ledger's reconciler is the
  same approach, with replays landing in the queue path. The ADR that adopts it cites PR #13. The
  PR's live findings (replay keeps `svix-id`, List Events ids equal `svix-id`, ≈ 8 s visibility)
  are a contributor's observations, not Resend's docs, so they stay RS-U01, RS-U02 and RS-U13.
- **[Issue #8](https://github.com/resend/resend-webhooks-ingester/issues/8)** (open) asks for
  per-email event correlation. Ledger's order-independent projection answers that question in its
  own repo. Upstream PRs are not planned (owner calibration), and the projection stays reusable in
  `packages/core` in case that changes.
- Nothing else open upstream touches replay, ordering, idempotency or queues (2026-10-15).

## Postgres host

Part 2. Where the ledger, projections and outbox live. Ledger's code is host-agnostic: it needs
a Postgres connection string over TLS ([idea §5.8](../docs/idea.md#58-infrastructure-and-operations)).
This section picks the host for the owner's kept-up deployment, which the README's deploy guide uses
as its default.

### Requirements

From the tie-break order (correctness > evidence > cost > scope > polish):

- **R1 Correctness:** interactive transactions with row locks (`SELECT … FOR UPDATE`) from the
  worker Lambda ([idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger)).
- **R2 Idle cost:** near zero while the stack stays up for an unknown review window, inside the
  ≤ USD 5/month all-in target ([about.md → Success metrics](about.md#success-metrics)).
- **R3 No NAT:** reachable from Lambdas outside any VPC (AWS-13).
- **R4 Stays up:** never paused or deleted under a kept-up deploy's own traffic
  ([lens clause 7](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)).
- **R5 Connections:** survives worker bursts within the ESM `MaximumConcurrency` cap (AWS-04).
- **R6 Drizzle:** a supported driver with `db.transaction()`.
- **R7 Teardown:** nothing left billing after the owner tears down.

### Comparison

Vendor pages read 2026-10-15. `[Unverified]` cells are tracked in [\[Unverified\]](#unverified).

| Host | Idle cost (R2) | Scale to zero / resume | Lambda without NAT (R3) | Interactive tx + `FOR UPDATE` (R1) | Pausing / deletion (R4) | Connections (R5) | Drizzle (R6) | Teardown (R7) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Neon Free**, `aws-us-east-2` | USD 0. "no credit card required", no overage billed on Free: at the limit "your compute is suspended until the next billing period" ([pricing](https://neon.com/pricing), [plans](https://neon.com/docs/introduction/plans), [FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)). 100 CU-hours/project/month, 1 GB storage | Suspends after 5 min idle, fixed on Free. Resumes "within a few hundred milliseconds" ([scale to zero](https://neon.com/docs/introduction/scale-to-zero)) | Yes: public TLS endpoint. Neon's Lambda guide uses `node-postgres` ([aws-lambda](https://neon.com/docs/guides/aws-lambda)) | Yes, over TCP (`pg`) or the WebSocket `Pool`. The HTTP driver is "non-interactive" only ([serverless driver](https://neon.com/docs/serverless/serverless-driver)). Through the pooler, PgBouncer assigns a server connection "during a transaction" ([PgBouncer](https://www.pgbouncer.org/features.html)), so locks hold for the transaction (PG-U02) | "a Neon project never pauses" ([vs Supabase](https://neon.com/guides/neon-vs-supabase-free-plan)). A 90-day inactivity deletion rule for Free projects, from 2026-10-05, appears only in an Azure warning box ([regions](https://neon.com/docs/introduction/regions)): PG-U01 | PgBouncer, transaction mode, `max_client_conn=10000`. A 0.25 CU compute allows `max_connections` 104. No session-level advisory locks, `SET`, `LISTEN` or SQL `PREPARE` through the pooler ([pooling](https://neon.com/docs/connect/connection-pooling)) | `node-postgres`, `neon-serverless` (tx). `neon-http` throws on `db.transaction()` ([connect-neon](https://orm.drizzle.team/docs/connect-neon)) | Delete the project. Recoverable for 7 days, "no storage costs" meanwhile ([projects](https://neon.com/docs/manage/projects)) |
| **Aurora Serverless v2 + Data API** | Storage only while paused (AWS-43). Awake: 0.5 ACU × USD 0.12/h (AWS-44), plus the Data API secret, USD 0.40 (AWS-11, AWS-45) | Auto-pause at 0 ACU after ≥ 300 s with no connections. Resume ≈ 15 s, ≥ 30 s after a day paused (AWS-41–AWS-43) | Yes, via the Data API's HTTPS endpoint (AWS-45) | Data API transactions, 3 min idle and 1 h max (AWS-46). Whether row locks hold across calls is AWS-U08 | Never deleted; pauses only by design | Data API pools connections and runs `DISCARD ALL` (AWS-46) | `aws-data-api/pg`. `db.transaction()` support is PG-U05 | In CDK. Default `SNAPSHOT`, so `DESTROY` is required (AWS-47) |
| **RDS + RDS Proxy** | Instance-hours plus Proxy-hours, no scale to zero. Rejected ([decision-lens-suite case 9](decision-lens-suite.md)) | No. A Proxy also blocks Aurora auto-pause (AWS-48) | No: the Proxy "can't be publicly accessible" and needs a VPC, so NAT (AWS-13, AWS-48) | Yes | — | Proxy | `node-postgres` | In CDK |
| **Supabase Free** | USD 0; "we do not charge for paused projects" ([billing FAQ](https://supabase.com/docs/guides/platform/billing-faq)). Pro "From $25 / month" ([pricing](https://supabase.com/pricing)) | Not scale-to-zero. The whole project pauses instead | Shared pooler, IPv4. Direct connections are IPv6 unless a paid add-on ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)) | Yes, in session mode. Transaction mode "does not support prepared statements" ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)) | **Fails R4:** "Free projects are paused after 1 week of inactivity", restored by hand in Studio ([pricing](https://supabase.com/pricing), [upgrading](https://supabase.com/docs/guides/platform/upgrading)) | Supavisor; `prepare: false` in transaction mode ([connect-supabase](https://orm.drizzle.team/docs/connect-supabase)) | `postgres-js` | Delete the project |
| **Aurora DSQL** | Not researched: rejected on R1 | — | — | **Fails R1:** optimistic concurrency, so `FOR UPDATE` doesn't block and conflicts abort at commit (AWS-49) | — | — | — | — |

### Decision — Neon

**Neon Free in `aws-us-east-2`** hosts the owner's kept-up deployment. Ratified by the owner on
2026-10-15. **Fallback:** Aurora Serverless v2 + Data API.

- **Why it wins:**
  - **R1:** interactive transactions over plain TCP Postgres. The deployed driver is
    `drizzle-orm/node-postgres`, the same one the Testcontainers integration tests use, so the
    tested path is the deployed path.
  - **R2:** costs USD 0 at any wake pattern, and a quota breach suspends the compute instead of
    billing. Aurora's 0.5-ACU awake floor at the hourly cadence is ≈ USD 4.40/month on its own
    (AWS-44), which with the rest of the stack (≈ USD 1.20–1.90, [aws.md](aws.md#cost-shape))
    breaks the ≤ USD 5 target.
  - **R3:** a public TLS endpoint, no VPC.
  - **R4:** Neon says a project "never pauses", unlike Supabase (PG-U01 aside).
  - Resume in hundreds of milliseconds, against Aurora's ≈ 15–30 s.
- **What the loser wins:** Aurora keeps everything inside one AWS account and one bill. It has
  IAM-authenticated access with no database password, CDK-managed teardown inside
  `cdk destroy --all`, the AWS budget and kill switch covering the database too, and more visible
  AWS learning.
- **Fallback + trigger.** Switch to Aurora, by an ADR, when any of these happens:
  - Neon's Free terms change so that a kept-up deploy is paused, deleted or billed (watch PG-U01);
  - the compute is suspended for quota once under kept-up traffic (PG-U03);
  - the owner decides on an all-AWS deployment.

  The fallback is **not ready** until AWS-U08 and PG-U05 are settled by a test against a real
  cluster, and its idle cost needs a cadence slower than hourly to fit the target.
- **Deviation note:** Resend's [stack page](https://resend.com/handbook/engineering/what-is-our-tech-stack)
  names "Postgres as our main storage system" and Drizzle, and says "we choose the best provider
  for the job", with workloads split between Vercel and AWS. Neon keeps Postgres + Drizzle. Only
  the host sits outside AWS, because that is the only way to meet R2.

**How it is used (MUST):**

- **Connection.** Runtime Lambdas use the **pooled** connection string with `sslmode=require`.
  Neon's guidance is "Use pooled connections by default" and direct connections for migrations
  ([choose-connection](https://neon.com/docs/connect/choose-connection)). Migrations run with the
  direct URL from the deploy command, never from a runtime Lambda. Where they run is fixed in
  [architecture.md](architecture.md).
- **Pool size.** Each Lambda container keeps one module-scope `pg` pool of size 1. The worker's
  ESM `MaximumConcurrency` therefore bounds open connections (AWS-04), far below the pooler's
  limits.
- **Pooler-safe SQL only.** No session-level advisory locks, `SET`, `LISTEN/NOTIFY` or SQL-level
  `PREPARE` ([pooling](https://neon.com/docs/connect/connection-pooling)). Mutual exclusion uses row
  locks or transaction-scoped locks inside one transaction.
- **A cold or dropped connection is retryable.** The worker reports the batch item as failed, so
  the message stays in SQS (AWS-05). Ingest never touches the database, so a cold database never
  fails a Resend delivery.
- **Outside the AWS budget.** Neon spend is not covered by the AWS budget or kill switch. On Free,
  it cannot bill. Moving to a paid Neon plan is an owner decision, because that spend sits outside
  the hard cap ([Open decisions](#open-decisions)).
- **Teardown.** `cdk destroy --all` remains the one command that stops all spend. Neon Free
  bills nothing either way. Deleting the Neon project (console or API) removes the data. It is
  optional, documented in the teardown guide, and recoverable for 7 days.

#### Cadence and the database

Scheduled ticks are free on the AWS side (AWS-26), but every tick that opens a connection wakes the
Neon compute for at least the 5-minute suspend window
([aws.md → Constraint 3](aws.md#constraints-and-sharp-edges)).

- **Idle wake budget: ≤ 30 CU-hours/month**, a third of the Free allowance. The rest stays free
  for demos, the 10k burst and CI against a branch.
- **Hourly reconcile fits.** About 6 min awake per hour × 0.25 CU × 730 h ≈ **18 CU-h/month**.
  This is an estimate, measured by PG-U03.
- **A 15-minute tick does not fit.** About 22 min awake per hour comes to ≈ 67 CU-h.
- **So:** no scheduled tick that touches Postgres runs more often than hourly by default.
  Database-touching ticks share one hourly schedule (one wake). The dispatcher is therefore not
  a sub-hourly poller. Its trigger shape (worker-triggered after commit, plus an hourly sweep) is
  decided in [architecture.md](architecture.md).

### [Unverified]

Each row names the slice that owes it ([about.md → Open questions](about.md#open-questions)).
Ids are stable: never renumber, never reuse.

| Id | Claim | Why unsettled | What would settle it | Owed by |
| --- | --- | --- | --- | --- |
| PG-U01 | Neon's 90-day inactivity deletion of Free projects does not reach a project that a scheduled tick touches hourly | The rule ("as of October 5, 2026") sits in an Azure-deprecation warning box. Whether it covers AWS regions, and what counts as activity, is unstated. Deletion would lose the ledger ([lens clause 6](../AGENTS.md#decision-lens--evidence-over-claims-right-sized)) | Neon docs or support. The hourly reconciler writes a `reconcile_runs` row either way | *durable ingest · M1*. MUST be settled |
| PG-U02 | `SELECT … FOR UPDATE` locks hold for the whole transaction through Neon's transaction-mode pooler | Inferred from PgBouncer's definition. Neon's page doesn't name it | A deployed concurrency test: two transactions on one `email_id` through the pooled URL serialize | *durable ingest · M1*. MUST be settled |
| PG-U03 | Idle use stays inside the wake budget (≈ 18 of 100 CU-h/month) | An estimate from the 5-min suspend window | Neon's usage page after 30 idle days, recorded beside [aws.md → Cost shape](aws.md#cost-shape) | *durable ingest · M1*. Safe on cost (Free never bills), not on availability: a suspended compute drains the queue into the DLQ ([aws.md → Constraint 4](aws.md#constraints-and-sharp-edges)) |
| PG-U04 | A module-scope connection survives the compute suspending under it | Neon doesn't say what happens to open client connections at suspend | A worker or tick test after > 5 min idle | *durable ingest · M1*. Safe either way (a connection error is retryable; reconnect on error) |
| PG-U05 | Drizzle's `aws-data-api/pg` driver supports `db.transaction()` | Neither the connect page nor the transactions page says | Drizzle's source or a test against a real cluster | Not owed while Neon holds. The ADR that switches to the fallback settles it |

## Open decisions

| Decision | Owner input needed | Status |
| --- | --- | --- |
| Postgres host | — | **Decided:** Neon Free, Aurora fallback (owner, 2026-10-15) |
| Accept a non-AWS DB account for the demo | — | **Decided:** yes, with the deviation note above (owner, 2026-10-15) |
| Reconcile cadence and limiter headroom | — | **Decided:** hourly (owner, 2026-10-15); 2 req/s default |
| Key and secret layout | — | **Decided:** split by trust boundary (owner, 2026-10-15) |
| Worker transaction driver | — | **Decided:** `drizzle-orm/node-postgres` over the pooled URL; follows the host |
| Neon paid plan if Free quota is hit | Yes, when PG-U03 or a quota suspension fires | Recommended: Aurora per the trigger above, or Neon Launch (USD 0.106/CU-h, no minimum, [plans](https://neon.com/docs/introduction/plans)) only if the owner accepts spend outside the AWS hard cap |
