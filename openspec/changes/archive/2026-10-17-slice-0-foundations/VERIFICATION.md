# Verification — 2026-10-17

**Verdict:** done, ready for `rsa-manual-test`, then `opsx:archive`
**Gate:** `pnpm verify` exit 0, every stage run, on `73ed3c4`, the last code commit (`a9620ce` and this file touch the change folder only). Also green before the repairs, locally and in CI, on `3cfe71b`
**Read:** `a7616da...3cfe71b`: 82 readable files, 6,451 added lines (`pnpm-lock.yaml` counted, not read) · the four change artifacts, `REVIEW.md`, `WALKTHROUGH.md` · the slice 0 card, ADR-003, ADR-013, Reliability core, data-modeling (`email_state`, `email_recipients`, `recipient_state`, PII & retention), resend.md (RS-U10/U11/U12/U19, RS-36–RS-38), about.md, features.md, root AGENTS.md · pp-workflow, pp-general, pp-backend (core), pp-testing
**Fixed:** 13, one commit each: `7c59605` `a79d56c` `8b7883d` `ba3784f` `60898aa` `7464e56` `43776df` `ab36de7` `5165e31` `32141a9` `e699083` `73ed3c4` `a9620ce`

## Judgement calls the owner should know about
- `data.tags` is typed as a string map, as every Resend example shows. A payload whose `tags` had another shape would fail the parse and be skipped by projections (stored raw, rebuildable after a schema fix). One sentence that changes it: "type every field the projection never reads as `z.unknown()`".
- `fast-check` stays a `devDependency` of `sim` although `sim` imports it at runtime: that is the approved scope (PP §7), and `sim` is never installed with `--prod`.
- The link check stays inline-links-only (D19): reference-style links, HTML `href`/`src`, and links to untracked or git-ignored files are not checked. The README uses none today.
- `ledgerHistory` shares a recipient across emails on most samples, not all (about 2% of seeds have none); its comment now says so rather than forcing it, which would change the walkthrough's seed-42 output.

## Re-verified here (open in `REVIEW.md`)
- gitleaks' `git` mode reads a bare mirror: it reports the same commit count as `git rev-list --all`, and a mirrored canary is caught (probe, pinned image).
- All 11 fixtures equal the live `webhooks/emails/*.md` examples, apart from the substitutions the test's table records (fetched 2026-10-17).
- RS-36–RS-38's quotes are on their cited pages (2026-10-17).
- `fc.sample` determinism on Linux: the CI run on `3cfe71b` passed the e2e stage.

## What this verification could not confirm
- The four Ask-first approvals are taken from PP §7's table, not re-heard from the owner. The manifests match that table exactly (`zod` 4.6.7, `fast-check` 4.10.2 plus `pure-rand`, the digest-pinned image, no `ci.yml` edit).
- The walk itself: `rsa-manual-test` executes `WALKTHROUGH.md`; this check desk-checked its quoted outputs against the code.
