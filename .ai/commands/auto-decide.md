# auto-decide — let an agent decide in my place, on the record

> **TEMPLATE — not ratified.** Bootstrap step 12 in [bootstrap-checklist.md](../bootstrap-checklist.md). The preview content below is illustrative, drafted from [docs/idea.md](../../docs/idea.md) without research. Nothing here is binding until this banner and the instructions comment are removed.

<!-- AGENT INSTRUCTIONS
Purpose: a paste-in paragraph that turns "stop and ask" into "decide from the docs, log it, hand
the owner a summary" for runs the owner will not attend, while naming what is never decided alone.

Consumers: the owner only, pasting it by hand into an unattended prompt. Never context, never
auto-invoked (commands/AGENTS.md).

Inputs (read first): commands/AGENTS.md (rules: self-contained, generic, budgeted, staged);
root AGENTS.md → Decision lens and Permissions (Ask-first list); about.md → Risk appetite and Open
questions; decision-lens-suite.md.

Research: none external. Check the never-alone list against root AGENTS.md → Permissions
(Ask first) and about.md → Risk appetite, so the three agree. If they diverge, fix the source, not
this file.

Required structure: title line; one sentence on when to paste it; a **Budget** line (model,
fan-out cap, tool-call cap); a **Persistence** line; one fenced paste-in block. The block MUST be
self-contained: no repo paths that must resolve, no project names it depends on, no links.

Evidence rules: every limit in the block matches the Budget line. The never-alone list is the
union of root Ask-first and about.md's never-tolerable items, nothing looser.

Owner decisions to surface (one batched round, one recommended pick each): the model for lookups
(recommend the cheapest fast model); whether parked items also stop dependent work (recommend: skip
dependents, continue the rest).

Done when: the block passes the commands/AGENTS.md rules; the never-alone list matches Permissions;
banner and this comment are removed; commands/AGENTS.md table still describes it accurately.
-->

Paste the block below into any prompt that will run without you: a long build, a background agent,
an overnight task.

**Budget:** one read-only subagent per open question, at most 3 in flight, ≤ 15 tool calls each,
a cheap fast model for pure lookups [Preview]. **Persistence:** each decision is appended to
`AUTO-DECISIONS.md` the moment it is made, so a crash loses one row, not the run.

```
When you reach a decision I would normally make and I am not here, do not stop and do not
decide from memory. For each open question, spawn one fresh read-only subagent with no context
from your session. It answers from the project's ratified product docs first (the .ai/ folder),
then the project's decision lens, then the code, and reports the exact wording it found, not a
paraphrase. Keep at most 3 subagents in flight, at most 15 tool calls each, on a cheap fast
model for pure lookups. If the quoted wording settles the question, that is the answer. If
nothing settles it, decide with the project's own decision lens, arguing only from the reasons
it allows, never from taste. Append every decision to AUTO-DECISIONS.md as you make it, never
at the end, one row each: what came up, what settled it (sentence quoted), what you chose, what
it rules out, how to reverse it.

These are never decided this way, however clear the reasoning looks: adding a dependency;
changing CI; editing or deleting a migration that has already been pushed; weakening, skipping
or disabling any verification gate; any AWS deploy or creation of an AWS resource; any write call
against a live Resend account (replay, rotate a secret, create or update a webhook, send email);
any public contract change (read API routes, error codes, CLI commands or flags, MCP tools).
Park each with its reason, skip whatever depends on it, and continue with everything else.

Finish by turning AUTO-DECISIONS.md into a summary table I can check one row of in thirty
seconds, parked items first. If it is empty, say so at the top.
```
