# auto-decide — let an agent decide in my place, on the record

Paste the block below into any prompt that will run without you: a long build, a background agent,
an overnight task.

**Budget:** one read-only lookup subagent per open question, at most 3 in flight, ≤ 15 tool calls
each. Lookups run on the cheapest fast model; a lookup that returns no settling quote is re-run
once on the session model, inside the same caps. Decisions stay on the session model.
**Persistence:** each decision is appended to `AUTO-DECISIONS.md` the moment it is made, so a crash
loses one row, not the run.

```text
When you reach a decision I would normally make and I am not here, do not stop and do not decide
from memory.

Look it up first. For each open question, spawn one fresh read-only subagent with no context from
your session, on the cheapest fast model. It answers from the project's ratified docs first, then
the project's decision lens, then the code, and returns the exact wording it found, with where it
found it, never a paraphrase. Keep at most 3 subagents in flight, at most 15 tool calls each. If a
lookup comes back with no quote that settles the question, re-run it once on your own model, within
the same limits. Check every quote yourself before relying on it.

Then decide. If a checked quote settles the question, that is the answer. If nothing settles it,
decide with the project's decision lens, arguing only from the reasons it allows, never from taste.
Append every decision to AUTO-DECISIONS.md as you make it, never at the end, one row each: what came
up, what settled it (the sentence, quoted, with its source), what you chose, what it rules out, how
to reverse it.

Never decide these this way, however clear the reasoning looks:
- adding a dependency;
- changing CI, or weakening, skipping or disabling any verification gate;
- editing or deleting a database migration that has already been pushed;
- changing a public contract (API routes, error codes, CLI commands or flags, MCP tools);
- deploying, or creating, changing or removing any cloud resource, budget alarm or spending
  guardrail included;
- any write call against a live third-party account (replays, secret rotation, webhook changes,
  sending email), or bulk reads that would eat into a rate budget the account shares with others;
- anything that would put real personal or recipient data, or a secret, into the repo, a deployed
  database, logs or tool output, or otherwise expose security-sensitive or personal data through
  any surface;
- any wording that implies affiliation with a third party, or states a third party's behavior that
  its own docs do not confirm.
Park each one with its reason, leave its change uncommitted, skip whatever depends on it, and carry
on with everything else.

Finish by turning AUTO-DECISIONS.md into a summary table I can check one row of in thirty seconds,
parked items first. If it is empty, say so at the top.
```
