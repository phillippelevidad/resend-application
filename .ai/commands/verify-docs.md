# verify-docs — a full, back-to-back verification round over the design docs

Paste the block below into a fresh session when the design docs need a full audit: before the build
starts, at a milestone boundary, or after a large doc rewrite. It finds errors, contradictions, bad
decisions and security gaps, fixes what is settled, and brings you only the decisions that are
yours.

**Budget:** 6 read-only review subagents in parallel, plus 1 verifier, plus at most 1 fixer per
file under edit. Each subagent stays under about 80 tool calls. All of them run on the session model:
this is judgement work. Reviewers and the verifier run no git commands and edit nothing but their
own output file. The orchestrator commits.
**Persistence:** each stage writes its own file under `<run>/stages/` (git-ignored), and the
orchestrator keeps `<run>/PROGRESS.md` current. A crash, a rate limit or a `/clear` loses one stage,
not the run. To resume, read `PROGRESS.md` and continue from the first stage not marked done.

```text
Run a verification round over this project's design docs. The run folder is
<docs-dir>/reviews/<date>-docs-verification/ (stages/ inside it git-ignored). Keep PROGRESS.md there
current after every stage.

Stage 0 — setup. Write stages/BRIEF.md, shared by every subagent: the docs in scope (read in full,
never sampled), the frozen and private paths that are out of scope, the bar (only things actually
wrong or risky, judged by the project's decision lens, never by taste or hypothetical scale), the
three buckets below, and one finding format: id, severity, kind, every file:line, exact quotes,
the concrete failure, the concrete fix, the proposed bucket with its reason. Run a mechanical link
and anchor check over the tracked markdown and save its output for the consistency pass.

Stage 1 — review. Spawn 6 read-only subagents in parallel, each writing one stage file
incrementally:
 1. consistency: the same fact stated twice and disagreeing, every ID (decisions, fact IDs, error
    codes, tables, slices, milestones) defined once and referenced faithfully, links that resolve
    to a section that does not say what the link claims, skills that restate a doc differently;
 2. third-party facts: every claim about the vendor the project integrates with, re-checked
    against the vendor's live docs, quoted;
 3. cloud facts and cost: every cloud limit and semantic re-checked against the provider's docs,
    every fixed or hourly charge, the budget alarm and kill switch (can a runaway outrun it?),
    one-command teardown with no billing residue;
 4. architecture: run the architecture-designer skill as the lens, subordinate to the project's
    decision records and decision lens; trace every message path for loss, duplicate effects and
    order-dependent state; contradictions between decisions; slices that depend on later slices;
 5. security and PII: signature verification, auth and scopes, least privilege per surface,
    tool output to AI agents, PII storage, hashing, masking, retention, logs, secrets, public-repo
    hygiene;
 6. contract and plan: data model vs operations vs error codes vs the build plan, and every
    reliability claim mapped to the test or invariant that proves it and the slice that lands it.

Stage 2 — verify. One subagent reads every stage file, dedupes across passes, tries to disprove
each finding against the docs and the cited sources, and writes stages/verified.md: survivors only,
each with a final bucket:
 A — low stakes: typos, anchors, stale cross-references, drift with an unambiguous canonical source;
 B — settled: a ratified sentence or the decision lens settles it, quoted verbatim with file:line;
 C — owner decision: reopens an accepted decision record, is ask-first (dependency, CI, public
     contract, cloud resources, live third-party writes), changes a slice's scope or a decision, or
     nothing quoted settles it. Each C item carries one recommended option and why.

Stage 3 — fix A and B. Group fixes by file, one fixer subagent per file so edits never collide.
Run the cheap checks, then commit and push each logical group. If a fix touches the decision lens,
re-score its whole regression suite and record the score. Mark each finding fixed in verified.md.

Stage 4 — owner decisions. Put every C item to me in one batched round, recommended option first.
Apply what I pick, commit and push. Write <run>/decisions.md (committed): every finding, its
bucket, its outcome, the commit that fixed it. stages/ stays local and uncommitted.
```
