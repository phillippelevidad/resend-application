# Review — 2026-10-19

**Verdict:** ready for `opsx:apply`
**Checked against:** the slice card · `.ai/pre-proposals/2026-10-19-slice-4-recovery.md` · pp-workflow, pp-general, pp-backend, pp-database, pp-testing, pp-cli, pp-infra · the repo at `6179a3a`
**Repaired:** 5 (task order: `ApiDeps.reconcilerInvoke` and `apiEnv.RECONCILER_FUNCTION_NAME` landed one to five groups before their readers, so groups 4–8 could not pass `pnpm check` — now D48, tasks 4.1, 4.3, 8.1, 8.5, 8.7, 9.2, 9.3; the third `createApi` caller `packages/api/scripts/export-openapi.ts` named; PP §14 rule 5's out-of-order replay restored as a reconciler scenario and a `recovery.int.test.ts` case; PP §22's pp-testing clock note restored in 7.4; D42–D47 made into `####` decisions so their citations resolve)

## Judgement calls the builder should know about
- The integration tests' fake clock starts at wall-clock time (D43, 6.3, 6.4), because `started_at` and `hasUnfinishedRun` read Postgres's `now()` while the horizon and the limiter read the clock port. Writing `started_at` from the clock port would remove the coupling but change PP §8's `DEFAULT now()` row time; not done.
- `reconcilerInvoke` stays required on `ApiDeps` (D48). An optional one would compile early but let `reconcile.start` insert a run nothing invokes.
- The checker's `[decisions]` and `[contract]` BLOCKs on D1–D41, `webhooks.get`, `emails.send` and the fake API's Resend paths are false positives: its decision regex reads `###` headings only (this design, like slice 3's, uses `####`), and Resend SDK methods and repository functions are not Ledger operations.

## What this review could not confirm
- Live Resend behavior (RS-U01, RS-U02, RS-U20 first): E1 settles it; task 1.5 asks to run it before any code.
- The `aws-cdk-lib` 2.273.0 `.d.ts` lines behind C15 and C21: taken from the checked pre-proposal; task 9.1 re-reads them.
- The README's "Ingester's open PR #13" reference: not re-fetched.
