# Docs verification run 2026-10-15 — progress

Procedure: [.ai/commands/verify-docs.md](../../commands/verify-docs.md). Resume from the first stage
not marked done.

| Stage | Status | Output |
| --- | --- | --- |
| 0 — setup | done | `stages/BRIEF.md`, `stages/linkcheck.txt` (no broken links; template links resolve from `.ai/pre-proposals/`) |
| 1 — review (6 passes) | done — 131 raw findings | `stages/pass-1-consistency.md` … `stages/pass-6-contract-plan.md` |
| 2 — verify | done — 96 items (63 A/B, 33 C), 10 finding parts rejected | `stages/verified-v1.md` (reliability, security, cost), `stages/verified-v2.md` (facts, consistency, contract) |
| 3 — fix A and B | done — 140 edits by three fixers on disjoint files; case 16's Verdict held for V2-19 | `stages/fix-F1.md` … `fix-F3.md`; commits on `repo-setup` |
| 4 — owner decisions | waiting for the owner — 33 C items, recommended option first | [decisions.md](decisions.md). Each C card's exact edits are in `stages/verified-v*.md`. Note: V2-03's features.md edit must be re-placed (V1-54 rewrote its target); V1-13's new fact row is AWS-53 |
