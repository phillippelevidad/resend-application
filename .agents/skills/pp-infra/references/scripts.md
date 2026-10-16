# AWS-facing scripts

The deploy, teardown, re-arm and trip-drill commands (slice 2) and the gap script (slice 4). None
is an operation ([api-contract.md → Coverage](../../../../.ai/api-contract.md#coverage)), and each
exists because the step recurs per deploy, demo or review
([lens clause 1](../../../../AGENTS.md#decision-lens--evidence-over-claims-right-sized)). Running any
of them against AWS or a live Resend account is Ask-first ([Permissions](../../../../AGENTS.md#permissions)).

## Shape

- **`infra/scripts/<name>.ts`, one composition root each.** It parses `process.env` once at the
  top through `packages/shared`'s config loader
  ([config-and-env.md](../../pp-general/references/config-and-env.md#parse-once-at-the-composition-root)).
  These files and `infra/src/main.ts` are the only places under `infra/` that read `process.env`
  (pp-general's [review grep 14](../../pp-general/references/boundaries.md#review-greps) allowance).
- **Run by Node 24 directly**: `node --env-file-if-exists=.env.local infra/scripts/<name>.ts`, no
  `tsx` ([config-and-env.md](../../pp-general/references/config-and-env.md#local-env-file)). The
  scripts import workspace packages, so pp-general's `node_modules` type-stripping `[Unverified]`
  applies to them ([imports-and-tsconfig.md](../../pp-general/references/imports-and-tsconfig.md#node-24-runs-ts-directly)).
- **What they import.** Every AWS call through `@ledger/aws`, every database step through
  `@ledger/db`, the token mint from `@ledger/shared`
  ([data-modeling.md → `api_tokens`](../../../../.ai/data-modeling.md#api_tokens--read-api-bearer-tokens)),
  any Resend call through `@ledger/resend-client` ([module boundaries](../../../../AGENTS.md#module-boundaries)).
  A call only a script makes uses the concrete `packages/aws` adapter: one implementation is no
  reason for a port ([adding-things.md](../../pp-general/references/adding-things.md#add-an-interface)).
  Each import is declared `workspace:*` in `infra/package.json`.
- **Logic a script shares lives in its package**, the script only sequences: the role-then-migrate
  path the Postgres harness also runs ([pp-testing → Postgres harness](../../pp-testing/SKILL.md#postgres-harness),
  [pp-database](../../pp-database/SKILL.md)), the token mint, and the trip and restore steps the
  kill switch and the re-arm share (home: slice 2).
- **Fail closed.** A failed step exits non-zero and nothing after it runs, except
  [deploy step 8](#deploy). Every step that changes
  state reads it first, so a re-run is safe.

## Root package.json scripts

- Each command is a root `package.json` script, so it is one command (lens clause 7), and lands
  with its line in [root AGENTS.md → Commands](../../../../AGENTS.md#commands)
  ([Definition of done](../../pp-workflow/SKILL.md#definition-of-done)).
- **Names land in slice 2. Never `deploy`.** `pnpm deploy` is a pnpm built-in ("Deploy a package
  from a workspace", [pnpm docs](https://pnpm.io/cli/deploy)), and the `pnpm <script>` shorthand
  works "ONLY for scripts that do not share the same name as already existing pnpm commands"
  ([pnpm run](https://pnpm.io/cli/run), read 2026-10-16). A script named `deploy` would make
  `pnpm deploy` run the built-in. Check any other name against the installed pnpm's command list.
- **Inputs are contract.** A variable a script reads is public (Ask-first, listed in
  [api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions) and `.env.example`).
  The deploy command's flags are documented where they are decided, as `--issue-operate-token <name>`
  is in data-modeling.md.

## Running the CDK CLI

- `aws-cdk` is a devDependency pinned by the lockfile (Ask-first, slice 2), never a global install.
- **No shell.** Spawn the CLI's JavaScript entry with Node itself:
  `spawn(process.execPath, [cdkEntry, 'deploy', …args], { stdio: 'inherit' })`. On Windows a
  `.cmd` shim "cannot be launched using `execFile()`", a `shell` option is "not recommended, see
  DEP0190", and with a shell "any input containing shell metacharacters may be used to trigger
  arbitrary command execution" ([Node child_process](https://nodejs.org/docs/latest-v24.x/api/child_process.html),
  read 2026-10-16). The owner works on Windows, so this is the portable form.
- **[Unverified]:** how to resolve `cdkEntry` from the installed `aws-cdk` (its `package.json`
  `bin` field). Slice 2 settles it against the installed version.
- Deploy inputs go as `-c key=value` arguments ([env-and-inputs.md → Deploy inputs](env-and-inputs.md#deploy-inputs)).

## Deploy

The order is fixed by S-05, [ADR-018](../../../../.ai/architecture.md#adr-018--migrations-run-from-the-deploy-command-before-the-code-that-needs-them),
[integrations.md → How it is used](../../../../.ai/integrations.md#decision--neon) and
[data-modeling.md → PII & retention](../../../../.ai/data-modeling.md#pii--retention):

1. Refuse while the kill switch is tripped (the worker's reserved concurrency reads `0`) unless
   running as the re-arm, and record whether the worker's event source mapping is paused.
2. Ensure the DML-only runtime role exists, through the direct URL.
3. Run the migrations through the direct URL, by the same code path the harness runs.
4. Refuse an address-hash key whose `key_id` differs from a stored hash's prefix, before the key is
   written anywhere.
5. `cdk deploy` the guardrails stack, then the app stack (guardrails first:
   [Budget alarms](../../../../.ai/aws.md#budget-alarms) item 1).
6. Place the `ledger/database` value (data-modeling.md: the deploy command places the key). Where
   this falls relative to step 5 is slice 2's; the value never passes through CDK (CBL-01).
7. Insert the first `operate` token through the direct URL (`bootstrap`, `ON CONFLICT DO NOTHING`)
   and print it once, only when inserted; `--issue-operate-token <name>` mints a replacement.
8. Restore a pause recorded in step 1 (AWS-U09). It runs whenever step 5 started, also when step 5
   failed: a rolled-back update may re-apply `Enabled: true` too.

Recommended for slice 2, because each recurs per deploy (lens clause 1): run
[CBL-01](../../../../.ai/check-before-launch.md#deploy-configuration)'s grep over `cdk.out/` after
synthesis and refuse on a hit, and make a deploy of the owner's stack without the kill-switch flag
fail loudly ([CBL-16](../../../../.ai/check-before-launch.md#deploy-configuration)).

## Teardown

- **One command, owner-triggered:** `cdk destroy` the app stack, then the guardrails stack only
  when the app stack's destroy succeeded (the stacks declare no dependency, so `--all` does not
  guarantee the order and could leave a `DELETE_FAILED` app stack without guardrails: a budget-alarm gap, [Budget alarms](../../../../.ai/aws.md#budget-alarms)
  item 1), then the post-destroy listing of stack-tagged resources and `/aws/lambda/*` log groups through `@ledger/aws`, exiting non-zero on
  a billable leftover ([aws.md → Teardown](../../../../.ai/aws.md#teardown), which also lists what
  survives by design). It prints the steps outside AWS: delete the Resend webhook
  ([features.md → tear down](../../../../.ai/features.md#adopter-lifecycle)), and optionally the
  Neon project.
- Teardown is never automatic and never part of the kill switch.

## Re-arm

[Budget alarms](../../../../.ai/aws.md#budget-alarms) item 6: restore what the app stack declares
(remove every app function's reserved concurrency, re-enable the worker's mapping, restore the
throttles), warn when month-to-date spend is at or above the cap, then point at `ledger reconcile`.
It runs the kill switch's steps in reverse, from the same implementation.

**[Unverified] ([AWS-U10](../../../../.ai/aws.md#unverified)):** where month-to-date spend is read
and what each read costs. No `AWS-NN` fact covers the Cost Explorer API's request charge; the
budget's own spend figure may be the free source. Slice 2 adds the fact, or reads the budget.

## Trip drill

[Budget alarms](../../../../.ai/aws.md#budget-alarms) item 8: publish to the trip topic, observe
each throttle, force one kill-switch failure and observe its alarm, re-arm, reconcile. The recorded
run is slice 2's evidence and settles AWS-U01, AWS-U02 and AWS-U09
([aws.md → \[Unverified\]](../../../../.ai/aws.md#unverified)).

## Gap script

The [slice 4](../../../../.ai/build-checklist.md#4--recovery) Ships bullet is the script's spec,
read there. Same shape and rules as the others; its one send goes through `@ledger/resend-client`.
