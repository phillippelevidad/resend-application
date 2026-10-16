# Config and environment

One boot assertion per process, zero dependencies. Which variables are public and which are
internal is [api-contract.md → Conventions](../../../../.ai/api-contract.md#conventions): public
ones (`LEDGER_URL`, `LEDGER_TOKEN`, `LEDGER_SIMULATOR_SECRET`, `RESEND_API_KEY`, `DATABASE_URL`,
`AWS_REGION`, `AWS_PROFILE`, and any a user sets later) are a public contract; internal ones are set
by CDK on a Lambda and owned by `infra`. This file owns how code reads them.

## Parse once, at the composition root

- **Each composition root (`main.ts` in an app, and the `sim` and script entry points) parses
  `process.env` once at boot** with a Zod schema, through `packages/shared`'s config loader
  ([ADR-013](../../../../.ai/architecture.md#adr-013--pure-core-and-local-mode)).
- **It fails fast, naming the missing or invalid variable, never its value.** The loader reports a
  Zod issue's path and expectation only, because a value can be a secret or a database URL.
- **Packages receive typed config objects and never read `process.env`.** A factory takes its
  config as a parameter, so a test passes a literal and nothing reads the environment by surprise.
- The schema lives in `src/<app>.config.ts` beside `main.ts`
  ([coding-standards.md](coding-standards.md#role-suffixes)).

```ts
// apps/worker/src/main.ts
import { loadConfig } from '@ledger/shared';
import { workerConfig } from './worker.config.ts';

const config = loadConfig(workerConfig, process.env);
```

Check the loader's real signature in `packages/shared` once it exists; the shape above is the
convention, not an API.

## Secrets

A Lambda receives a secret's ARN in an internal variable, never its value, and reads the value
through `packages/aws` at runtime ([integrations.md → Secrets layout](../../../../.ai/integrations.md#secrets-layout)).
A config schema never declares a secret value for a Lambda.

## Local env file

Local entry points load `.env.local` with Node's own flag, no `dotenv`:

```sh
node --env-file-if-exists=.env.local apps/local/src/main.ts
```

- `--env-file-if-exists` behaves like `--env-file` but does not fail when the file is missing.
  Added in Node v22.9.0, no longer experimental since v24.10.0
  ([Node CLI docs](https://nodejs.org/docs/latest-v24.x/api/cli.html)).
- A variable already set in the environment wins over the file (Node CLI docs), so a shell export
  overrides `.env.local`.
- `.env.local` is git-ignored and never committed; `.env.example` lists names only, never values
  ([Permissions](../../../../AGENTS.md#permissions)).

## Adding a variable

- **Never invent a variable name a slice has not introduced.** A name comes from a slice card or
  from api-contract.md.
- A new **public** variable is Ask-first and is added to api-contract.md's list in the same change.
- A new **internal** variable is declared in the CDK construct of the function that reads it
  ([pp-infra](../../pp-infra/SKILL.md)).
- Every new variable owes its [Definition of done](../../pp-workflow/SKILL.md#definition-of-done)
  row (`.env.example`, and the boot-time assertion when it is required).
