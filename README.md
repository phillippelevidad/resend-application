# Ledger

A reliable email-event ledger for [Resend](https://resend.com) webhooks. It turns at-least-once,
unordered webhook deliveries into correct, queryable state and safe reactions, and recovers events
it missed.

> **Why this exists.** This is a portfolio project, built as part of an application to two
> engineering roles at Resend: **Backend Engineer** and **Software Engineer, Developer Tools**.
> It's an independent project, not affiliated with or endorsed by Resend.

**Status:** idea stage. Nothing below is built yet: it describes the design. Start with the
[idea doc](docs/idea.md).

## The problem

Resend sends your app a webhook each time something happens to an email: sent, delivered,
bounced, complained, opened. Receiving them is easy. Turning them into **correct state you can act
on** is hard, because real-world delivery is messy
([idea §1](docs/idea.md#1-purpose)):

- **Duplicates.** Retries and replays deliver the same event twice, so a naive handler fires two
  alerts or double-counts.
- **Out of order.** A late `email.delivered` can overwrite an earlier `email.bounced`, and the
  status goes backwards.
- **Bursts.** One broadcast produces a burst of webhooks for each recipient. The database runs out
  of connections, returns 5xx, and Resend's retries add even more load.
- **Gaps.** If your endpoint is down longer than Resend's retry schedule (about 28 hours), events
  are lost and nothing tells you.

Every Resend behavior Ledger relies on is checked against Resend's docs and cited in
[idea §2.1](docs/idea.md#21-how-resend-webhooks-behave-verified-facts).

## What Ledger does

1. **Accepts** webhooks quickly and durably: verify the signature, enqueue, return `200`. A slow
   or down database never turns into failed deliveries.
2. **Records** every event exactly once, then **projects** it into per-email and per-recipient
   state that comes out the same in any arrival order and with any number of duplicates.
3. **Reacts** to events (for example, "this address hard-bounced, stop emailing it") without
   running the same side effect twice.
4. **Recovers** events it missed, using Resend's Headless Webhook API.
5. **Answers questions** like "did this user get the password-reset email, and if not, why?" from
   a CLI, a typed SDK, or a read-only MCP server that an AI agent can use safely.

It runs on AWS (API Gateway, Lambda, SQS, Postgres), deployed with AWS CDK, written in TypeScript.
See the [architecture](docs/idea.md#51-architecture-overview).

These are the [goals](docs/idea.md#3-goals-and-non-goals), not yet guarantees. Each reliability
claim will ship with its evidence: a unit, property or integration test, or an invariant of the
[simulation and chaos harness](docs/idea.md#59-the-chaos-and-simulation-harness).

## Who it's for

| User | Their question |
| --- | --- |
| **App developer** | "Tell my app when an address stops being deliverable, without me writing webhook plumbing." |
| **Support / on-call** | "A customer says they never got the reset email. What actually happened?" |
| **Operator** | "We had an outage. Did we lose events? Recover them and prove it." |
| **AI agent** | "Explain why this delivery failed and suggest a next step, without being able to break anything." |

More in [idea §4](docs/idea.md#4-users-and-jobs-to-be-done).

## When you need it, and when you don't

Ledger is for teams where a wrong email status costs something: transactional email such as
password resets, receipts and alerts, or enough volume that bounces and complaints put sender
reputation at risk. For a small app sending a few hundred emails a day, a simple webhook handler is
usually enough.

## How it relates to Resend's Webhook Ingester

Resend's open-source [Webhook Ingester](https://resend.com/docs/webhooks/ingester) answers "what
happened?": it verifies webhooks and stores each event as a row in your database. Ledger answers
what comes next: "what's true now, and what should we do about it?" It's designed to complement
the Ingester, and to offer useful pieces upstream
([idea §2.2](docs/idea.md#22-what-already-exists-the-resend-webhook-ingester)).

## License

[MIT](LICENSE)
