# Coding standards

The canonical file and symbol naming for every TypeScript file, plus the comment rules. The
path-specific skills add no suffix of their own: a new role is added to this table, in the same
change that first needs it. Where a file goes is the owning skill's business (pp-backend,
pp-database, pp-cli, pp-mcp, pp-infra, pp-testing); this file owns only what the file and its
export are called.

## File names

- Files and folders are **kebab-case**. A file that plays a role carries one role suffix:
  `<subject>.<role>.ts`. A file that *is* the thing has none: `address.ts`, `mask.ts`.
- **One primary export per file.** Its name is the file's words, the role included, in the
  export's case: classes and types PascalCase (`get-email.reader.ts` → `GetEmailReader`),
  functions and values camelCase (`get-email.route.ts` → `getEmailRoute`). Secondary exports are
  the primary's own types (`GetEmailInput`, `z.infer` of a schema).
- Two fixed exceptions to the mirror. A `.handler.ts` exports `handler`, the export name CDK's
  `NodejsFunction` looks for by default ([`handler` prop](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunctionProps.html)). A name the
  [domain vocabulary](../../../../.ai/about.md#domain-vocabulary) fixes wins: `project-email.projection.ts`
  → `projectEmail`.
- **One suffix never means two things.** A grep for `*.repository.ts` finds every repository and
  nothing else.

## Role suffixes

| Role | Suffix | Example → export |
| --- | --- | --- |
| Lambda entry: event adaptation only (ADR-013) | `.handler.ts` | `ingest.handler.ts` → `handler` |
| Hono route: `createRoute` plus its handler (ADR-019) | `.route.ts` | `get-email.route.ts` → `getEmailRoute` |
| Write class, one public `execute(input)` (ADR-019) | `.command.ts` | `start-reconcile.command.ts` → `StartReconcileCommand` |
| Read class, one public `execute(input)` (ADR-019) | `.reader.ts` | `get-email.reader.ts` → `GetEmailReader` |
| Repository (`packages/db` only) | `.repository.ts` | `webhook-events.repository.ts` → `webhookEventsRepository` (one object of executor-first functions, [pp-database](../../pp-database/references/schema-and-repositories.md#repositories)) |
| Port interface (`packages/shared`) | `.port.ts` | `queue.port.ts` → `QueuePort` |
| Port implementation | `.adapter.ts` | `sqs-queue.adapter.ts` → `SqsQueueAdapter` |
| Zod schema | `.schema.ts` | `email-event.schema.ts` → `emailEventSchema` |
| Row or domain → wire (carries the masks) | `.mapper.ts` | `email-response.mapper.ts` → `emailResponseMapper` |
| Projection (`packages/core`) | `.projection.ts` | `project-email.projection.ts` → `projectEmail` |
| Reaction rule (`packages/core`) | `.rule.ts` | `bounce-suppression.rule.ts` → `bounceSuppressionRule` |
| CLI command definition, one per operation (pp-cli owns the shape) | `.cli.ts` | `email-get.cli.ts` → `emailGetCli` |
| MCP tool (pp-mcp owns the shape) | `.tool.ts` | `get-email-status.tool.ts` → `getEmailStatusTool` |
| Config schema for a composition root | `.config.ts` | `worker.config.ts` → `workerConfig` |
| Error class ([errors.md](errors.md)) | `.error.ts` | `ledger.error.ts` → `LedgerError` |
| CDK stack (`infra/` only; pp-infra owns the shape) | `.stack.ts` | `app.stack.ts` → `AppStack` |
| CDK construct (`infra/` only; pp-infra owns the shape) | `.construct.ts` | `ledger-function.construct.ts` → `LedgerFunction` |

**Tests** sit beside the code they test and add a tier suffix after the file's own name:
`.test.ts` (unit), `.prop.test.ts` (fast-check), `.int.test.ts` (real Postgres):
`project-email.projection.prop.test.ts`. [pp-testing](../../pp-testing/SKILL.md) owns their
mechanics.

**Exempt** (never renamed to fit): `index.ts` (a package's one public surface, `packages/*/src/`
only) · `testing.ts` (a package's `"./testing"` surface) · `main.ts` (a composition root) · files a
tool names, at a project root (`vitest.config.ts`, `drizzle.config.ts`, `biome.json`,
`tsconfig*.json`, `cdk.json`); a role `.config.ts` lives under `src/`, so the suffix keeps one
meaning per location · migrations as drizzle-kit names them · generated files
(`packages/sdk/openapi.json` and the generated SDK types) · docs (`AGENTS.md`, `SKILL.md`,
`README.md`).

## Identifiers

- English identifiers, in the [domain vocabulary](../../../../.ai/about.md#domain-vocabulary),
  including its **Never** column: an event is never a "message" (that is SQS's), a replay is never
  a "retry", a redrive is never a "replay".
- TypeScript fields are camelCase; Drizzle maps them to snake_case columns
  ([data-modeling.md → conventions](../../../../.ai/data-modeling.md#modeling-conventions-canonical)).
  Wire field names follow [api-contract.md](../../../../.ai/api-contract.md).
- "ESM" means the event source mapping. The module system is "ES modules"
  ([about.md → Domain vocabulary](../../../../.ai/about.md#domain-vocabulary)).
- No `I` prefix on interfaces; a port is named for its capability plus `Port`.

## Comments

- Comment the **why**; the code already says what.
- Cite the decision by id: `// ADR-015: retry once on a fresh connection, then pause the ESM.`
  `RS-NN`, `AWS-NN`, `CBL-NN` and `PG-UNN` ids work the same way.
- **Never paste `.ai/` prose into a comment.** Copies drift, and the copy is the one an agent
  trusts. Link or cite the id.
- A comment that states a rule uses RFC 2119 keywords.
- An `[Unverified]` assumption in code cites its `RS-UNN` / `AWS-UNN` / `PG-UNN` row.

## Shape of a change

- **Match the neighbours.** The smallest diff that does the job, in the surrounding idiom. A change
  that re-styles code it did not need to touch hides the real edit from review; Biome's formatter
  settles style.
- **Generated files are outputs.** Edit the source and regenerate; never patch the artifact
  ([Permissions](../../../../AGENTS.md#permissions)).
