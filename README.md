# Ledger

A reliable email-event ledger for [Resend](https://resend.com) webhooks. It turns at-least-once,
unordered webhook deliveries into correct, queryable state, and recovers the events it missed.

> **Why this exists.** This is a portfolio project, built as part of an application to two
> engineering roles at Resend: **Backend Engineer** and **Software Engineer, Developer Tools**.
> It's an independent project, not affiliated with or endorsed by Resend.

**Status:** M1 (the MVP) is built: durable ingest on AWS, order-independent state, recovery of
missed events, and a CLI and typed SDK over one read API. Not built yet: the MCP server,
reactions, and a local `docker compose` (see [Planned for M2](#planned-for-m2)). The living design is
in [`.ai/`](.ai/AGENTS.md): start with [about.md](.ai/about.md) and
[architecture.md](.ai/architecture.md). The [original RFC](docs/idea.md) is frozen as accepted, kept
for history.

## The problem

Resend sends your app a webhook each time something happens to an email: sent, delivered,
bounced, complained, opened. Receiving them is easy. Turning them into **correct state you can act
on** is hard, because real-world delivery is messy:

- **Duplicates.** Retries and replays deliver the same event twice, so a naive handler fires two
  alerts or double-counts ([RS-08, RS-16](.ai/resend.md#facts)).
- **Out of order.** Resend promises no delivery order, so a late `email.delivered` can overwrite an
  earlier `email.bounced`, and the status goes backwards.
- **Bursts.** One broadcast produces a burst of webhooks for each recipient. The database runs out
  of connections, returns 5xx, and Resend's retries add even more load.
- **Gaps.** If your endpoint is down longer than Resend's retry schedule (about a day,
  [RS-09](.ai/resend.md#facts)), Resend stops retrying those events, and an endpoint that keeps
  failing is disabled, with an email to your team ([RS-11](.ai/resend.md#facts)). Nothing tells you
  which events your system never stored.

Every Resend behavior Ledger relies on is checked against Resend's docs and cited in
[resend.md](.ai/resend.md). What the docs don't settle is marked `[Unverified]` there.

## What Ledger does

Each claim links the test, invariant or recorded run that proves it.

1. **Accepts** webhooks quickly and durably: it verifies the signature against every configured
   secret, enqueues, and only then returns `200`; a forged, stale or unsigned request never reaches
   the queue ([create-ingest.test.ts](packages/ingest/src/create-ingest.test.ts),
   [ADR-001](.ai/architecture.md#adr-001--verify-then-enqueue)).
2. **Records** every event exactly once, keyed on its `svix_id`, then **projects** it into
   per-email and per-recipient state that comes out the same in any arrival order and with any
   number of duplicates: property tests over every permutation
   ([project-email](packages/core/src/project-email.projection.prop.test.ts),
   [project-recipient](packages/core/src/project-recipient.projection.prop.test.ts)), duplicate and
   concurrent deliveries against real Postgres
   ([record-event.command.int.test.ts](packages/worker/src/record-event.command.int.test.ts)), and
   simulator invariants 1 and 2 ([invariant-1](sim/src/invariants/invariant-1.ts),
   [invariant-2](sim/src/invariants/invariant-2.ts)) run with duplicates and shuffling.
3. **Holds up** under load and failure: a 10,000-event burst on the deployed stack stored every
   event once ([ADR-008 → Evidence](.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq));
   a database outage keeps ingest answering `200` while the worker pauses and nothing reaches the
   dead-letter queue ([ADR-015 → Evidence](.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage));
   a poison message is isolated in the DLQ while the rest commit, then redriven from the CLI
   ([poison-isolation.int.test.ts](packages/worker/src/poison-isolation.int.test.ts), simulator
   [invariant 4](sim/src/invariants/invariant-4.ts)).
4. **Recovers** events it missed: hourly and on demand, it diffs the ids Resend's Headless Webhook
   API lists against the ledger and replays the missing ones through normal ingest, the same
   approach as the Ingester's open
   [PR #13](https://github.com/resend/resend-webhooks-ingester/pull/13). An outage past the retry
   schedule ends 100 % recovered with 0 duplicates, a disabled webhook and a `429` storm are
   handled, and runs never overlap
   ([recovery.int.test.ts](packages/reconciler/src/recovery.int.test.ts),
   [ADR-007 → Evidence](.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).
5. **Answers questions** like "did this user get the password-reset email, and if not, why?" from
   the `ledger` CLI or a typed SDK, both over one read API with one error shape, masks only
   ([api-contract.md](.ai/api-contract.md), the SDK ↔ API
   [contract suite](packages/api/src/testing/read-api-contract.ts)).

It runs on AWS (API Gateway, Lambda, SQS) with Postgres, deployed with AWS CDK, written in
TypeScript. See the [architecture](.ai/architecture.md#system-shape). The
[runbook](docs/runbook.md) has one entry per alarm and per error code.

## Planned for M2

- **Reactions:** acting on events, such as "this address hard-bounced, stop emailing it".
- **An MCP server** over the same read API, for AI agents.
- **A local `docker compose`** with a durable local queue.

None of these is built; see the [build checklist](.ai/build-checklist.md).

## Demo

The deployed stack's recorded runs, each with its command, seed and counts, no URL or id:

- the 10,000-event burst and the poison run
  ([ADR-008 → Evidence](.ai/architecture.md#adr-008--backpressure-bounded-concurrency-partial-batch-failure-dlq));
- the database outage, `pnpm sim --chaos db-outage`
  ([ADR-015 → Evidence](.ai/architecture.md#adr-015--the-worker-pauses-its-own-event-source-on-a-database-outage));
- the gap drill, `pnpm aws:gap-drill`: Resend's deliveries of one send refused at ingest, then found
  missing and replayed (`missing 2 replayed 2 failed 0`, then `missing 0`), and one replay of a
  stored event 41 h old deduped on its original `svix-id`
  ([ADR-007 → Evidence](.ai/architecture.md#adr-007--recovery-by-id-diff-and-replay-through-ingest)).

## Who it's for

| User | Their question |
| --- | --- |
| **App developer** | "Tell my app when an address stops being deliverable, without me writing webhook plumbing." |
| **Support / on-call** | "A customer says they never got the reset email. What actually happened?" |
| **Operator** | "We had an outage. Did we lose events? Recover them and prove it." |
| **AI agent** | "Explain why this delivery failed and suggest a next step, without being able to break anything." |

More in [about.md → Target personas](.ai/about.md#target-personas).

## When you need it, and when you don't

Ledger is for teams where a wrong email status costs something: transactional email such as
password resets, receipts and alerts, or enough volume that bounces and complaints put sender
reputation at risk. For a small app sending a few hundred emails a day, a simple webhook handler is
usually enough.

## How it relates to Resend's Webhook Ingester

Resend's [Webhook Ingester](https://resend.com/docs/webhooks/ingester) answers "what
happened?": it verifies webhooks and stores each event as a row in your database. Ledger answers
what comes next: "what's true now, and did we miss anything?" It's designed to complement the
Ingester, not to compete with it ([about.md → Positioning](.ai/about.md#positioning)).

## Develop

Prerequisites: Node.js `>=24.12 <25`, pnpm 10.11.0 (`corepack enable` picks it up from
`packageManager`), and Docker.

```bash
pnpm install    # install the workspace
pnpm dev:full   # local Postgres and the local server; prints LEDGER READY when up (pnpm dev:stop stops it)
pnpm check      # lint, typecheck and unit tests
pnpm verify     # the full gate, the same command CI runs
```

Every command is listed in [AGENTS.md → Commands](AGENTS.md#commands).

## License

[MIT](LICENSE)
