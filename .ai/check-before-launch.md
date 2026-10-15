# Check before launch

> **TEMPLATE — not ratified.** Bootstrap step 11 in [bootstrap-checklist.md](bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: The holder for checks that belong to no slice and bite at deploy time or later: AWS
  configuration nobody's test exercises, cost and teardown guarantees, public-repo hygiene before
  the demo is shared, and behavior only a real Resend account and real AWS reveal. It grows after
  every deploy and shrinks as items are settled.
Consumers: the owner before every deploy and before publishing the demo; wf-after-apply-check
  (homeless findings land here); slices that adopt an item (the row then leaves).
Inputs (read first): root AGENTS.md (cost brake, Permissions: deploying or creating AWS resources
  and any live Resend write are Ask-first; Never: secrets, real recipient addresses);
  AGENTS.local.md (public repo rules); .ai/AGENTS.md; bootstrap-checklist.md Owner calibration
  (deploy-and-keep: the stack stays up until the owner tears it down, so budget alarms with a
  hard monthly cap are mandatory); aws.md (step 5: AWS-NN facts, cost shape, budget-alarm design);
  architecture.md (step 7: ADRs, Deferred, risks); resend.md (RS-NN facts and its [Unverified]
  table); docs/idea.md §5.2, §5.8, §6.4, §10.
Research:
  - AWS: what `cdk destroy` retains by default (log groups, retained secrets, removal policies),
    AWS Budgets actions and their delay, API Gateway HTTP API body handling (base64, raw bytes),
    Lambda + SQS idle cost. Cite aws.md AWS-NN, not memory.
  - Resend: rotation overlap, replay svix-id, Svix delivery timeout. Cite resend.md RS-NN; what no
    page settles stays [Unverified].
  - No deploys and no live Resend writes while writing this file (Ask-first).
Required structure (headings MUST exist, in this order): `## What belongs here` · `## Deploy
  configuration` · `## Cost & teardown` · `## Public-repo hygiene` · `## Behaviour only production
  reveals` · `## Awaiting an owner decision`. Every section after the first is a table
  ID | Check | Why it bites | Settle by. IDs are stable `CBL-NN`, never renumbered or reused.
Evidence rules: every "Why it bites" cites the fact (AWS-NN, RS-NN, ADR) it rests on, or is tagged
  [Unverified]. A "Settle by" is a concrete command, query or observation, never "review".
Owner decisions to surface (one batched round): the hard monthly cap amount and the alarm
  thresholds (recommend from aws.md's measured idle cost, with a cap a few times that); whether
  the deployed demo is reachable by reviewers (read token, redacted) or shown only via recordings.
Done when: banner and this comment removed; every preview row is verified, rewritten with its
  citation, or deleted; aws.md's budget design is reflected in Cost & teardown; no row duplicates a
  Ships bullet.
-->

Things that are probably wrong, or probably missing, and belong to **no slice**. This file holds
them so a deploy or a published demo does not discover them first.

## What belongs here

An item MUST satisfy all three:

1. **No slice owns it.** If a `Ships` bullet in [build-checklist.md](build-checklist.md) covers it,
   it is that slice's.
2. **It bites at deploy time or later**, not during local development.
3. **It is cheap to check and expensive to discover.** Minutes to verify against a surprise bill, a
   leaked secret, or a silent loss of events.

**Exception:** [Awaiting an owner decision](#awaiting-an-owner-decision) holds decisions no slice
owns; tests 2 and 3 do not bind them.

An item MAY be a **suspicion**: tag it `[Unverified]`. A wrong entry costs minutes to disprove.

**Not here:** open questions that need Resend or AWS to answer go to
[about.md → Open questions](about.md#open-questions); deliberately unbuilt capabilities go to
[architecture.md → Deferred](architecture.md#deferred-yagni); work a slice carries stays on its card.

**Exit rule.** An item leaves when it is confirmed, disproved, or adopted by a slice: **deleted,
never struck through.** A confirmed defect that needs building becomes a `Ships` bullet and the row
goes.

## Deploy configuration

_(Preview rows.)_

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-01 | Signing secrets and the database URL come from Secrets Manager at runtime, not from Lambda environment variables in plain text | A plain-text env var is visible to anyone with console read access and lands in `cdk synth` output `[Unverified]` | Inspect the synthesized template for secret values; read one Lambda's configuration in the console |
| CBL-02 | Worker event-source maximum concurrency and the DLQ `maxReceiveCount` are set to the values the ADRs state | Defaults silently remove the backpressure valve ([idea §5.3](../docs/idea.md#53-worker-and-the-event-ledger)) | Read the deployed event source mapping and queue redrive policy |
| CBL-03 | CloudWatch alarms route to an SNS topic with a confirmed email subscription | An unconfirmed subscription means every alarm fires into nothing | Trigger a test alarm state and confirm the email arrives |

## Cost & teardown

The stack stays up until the owner tears it down
([owner calibration](bootstrap-checklist.md#owner-calibration-ratified-2026-10-15)), so these are
mandatory before the first deploy. _(Preview rows.)_

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-04 | An AWS budget with a hard monthly cap exists, alerts at stated thresholds, and its notification actually reaches the owner | Deploy-and-keep with unknown review timing: an unnoticed cost leak compounds for weeks | Read the budget in the console; force a low threshold once and confirm the notification arrives |
| CBL-05 | `cdk synth` contains no NAT gateway, no provisioned RDS instance, no always-on container | The [cost brake](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) forbids them without a measured reason | `grep` the synthesized template for `AWS::EC2::NatGateway`, `AWS::RDS::DBInstance`, `AWS::ECS::Service`; a CI assertion would move this to a slice |
| CBL-06 | What `cdk destroy` leaves behind (retained log groups, secrets pending deletion, the CDK bootstrap stack, the external Postgres) is listed in the deploy guide | "Torn down with one command" is a claim; leftovers keep billing or keep personal data `[Unverified]` | Destroy a scratch stack, then list remaining resources by tag |

## Public-repo hygiene

Before the repo or the demo is shared. _(Preview rows.)_

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-07 | Every address in fixtures, docs, recordings and simulator output is a Resend test address (`@resend.dev`) | A real recipient address in a public repo is personal data, and a Never in [AGENTS.md → Permissions](../AGENTS.md#permissions) | `git grep -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+'` and review every hit not ending in `resend.dev` |
| CBL-08 | A secret scan over the full history is clean (API keys, `whsec_` signing secrets, database URLs) | One committed secret survives in history even after deletion | Run a secret scanner over `git log -p` |
| CBL-09 | Every reliability claim in the README links to its evidence | The [decision lens](../AGENTS.md#decision-lens--evidence-over-claims-right-sized) requires it; a reviewer checks exactly this | Read the README claim by claim and follow each link |
| CBL-10 | No AWS account id, API Gateway URL, ARN or Resend webhook id appears in tracked files or recordings | Public repo rule ([.ai/AGENTS.md](AGENTS.md#rules)); a live URL invites junk traffic | `git grep` for 12-digit numbers, `execute-api`, `arn:aws`; review recordings frame by frame |

## Behaviour only production reveals

All `[Unverified]` until observed against a real Resend account and a real deploy.

| ID | Check | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-11 | Signature verification succeeds on the raw bytes behind API Gateway (no re-encoding, base64 handled) `[Unverified]` | A body re-serialized anywhere fails every signature: 100% `401`, and Resend eventually disables the endpoint | Send one real event via `resend webhooks listen` against the deployed route; read `ingest.rejected{reason}` |
| CBL-12 | A replayed event arrives with the same `svix-id` as the original `[Unverified]` (community evidence only, see resend.md) | If not, replays create duplicates and the dedupe argument for reconcile collapses | Replay one already-stored event (live write: Ask-first) and check `worker.duplicates` |
| CBL-13 | During signing-secret rotation, deliveries signed with either secret are accepted for the whole overlap `[Unverified]` | If Resend switches immediately, a single-secret ingest rejects deliveries until redeployed | Rotate on a test webhook (Ask-first) and watch `ingest.rejected` |
| CBL-14 | Ingest p99 latency, including Lambda cold starts, stays well under Svix's delivery timeout `[Unverified]` | Timeouts count as failures: retries, then auto-disable | Read p99 from the burst run in `docs/results.md`; compare with the timeout cited in resend.md |

## Awaiting an owner decision

Decisions no slice owns. _(Preview row.)_

| ID | Decision | Why it bites | Settle by |
| --- | --- | --- | --- |
| CBL-15 | How reviewers reach the deployed demo: a read-scoped token with redaction on, or recordings only | A public read token exposes whatever the ledger holds; recordings prove less | Owner picks; recommended: recordings plus a redacted read token handed out on request |
