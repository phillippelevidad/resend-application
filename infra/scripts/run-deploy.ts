import { Buffer } from 'node:buffer';
import { parseArgs } from 'node:util';
import { addressHashKeyId, tokenNamePattern } from '@ledger/core';
import type { ApiTokenValues, ContractStep } from '@ledger/db';
import { RUNTIME_ROLE } from '@ledger/db';
import { ConfigError, type Env, loadConfig, mintApiToken, tokenTagKeyId } from '@ledger/shared';
import { type DeployEnv, deployEnvSchema } from './deploy-env.schema.ts';
import { APP_STACK_NAME, GUARDRAILS_STACK_NAME } from './ledger-stacks.ts';
import { createScriptOutput, type ScriptOutput, type ScriptSink } from './script-output.ts';

// `pnpm aws:deploy` (D33, ADR-018): the input assertion, then twelve fail-closed steps over injected
// step functions, so the order and every refusal are unit-tested with fakes (run-deploy.test.ts) and
// deploy.ts only composes the real ones. Nothing changes a database, a stack or a secret before
// every refusal but the address-hash `key_id` check has run; that one needs the migrated database
// and still precedes every stack and secret write.

// The deployed app stack, as step 2 reads it. Absent when no app stack exists, or when one exists
// without its `DeployedCommit` output (a first create that rolled back holds no function).
export type DeployedApp = {
  // The commit the running Lambdas were built from (D27's output, never the one about to deploy).
  deployedCommit: string;
  // `null` when none is set. `0` means the kill switch tripped the stack (D29 step 2).
  workerReservedConcurrency: number | null;
  eventSourcePaused: boolean;
  databaseSecretArn: string;
};

export type DeployedState = {
  app: DeployedApp | undefined;
  // D28's `KillSwitchArmed`, or `undefined` with no guardrails stack.
  killSwitchArmed: boolean | undefined;
};

// What the deploy prints and writes after both stacks deployed.
export type DeployOutputs = {
  apiUrl: string;
  databaseSecretArn: string;
  signingSecretsArn: string;
  killSwitchArmed: boolean;
};

// The CDK context the app reads (`infra/src/infra.config.ts`), passed as `-c key=value`.
export type DeployContext = {
  commit: string;
  alertEmail: string;
  budgetUsd: number;
  killSwitch: boolean;
  budgetDrill: boolean;
};

export type DeploySteps = {
  isTreeClean(): Promise<boolean>;
  headCommit(): Promise<string>;
  readDeployedState(): Promise<DeployedState>;
  // D12: the pending migrations' contract steps, read over the direct owner URL.
  pendingContractSteps(): Promise<readonly ContractStep[]>;
  isAncestor(sha: string, deployedCommit: string): Promise<boolean>;
  synthesize(context: DeployContext): Promise<void>;
  // CBL-01's pattern over the synthesized assembly (template-secrets.ts).
  findTemplateSecret(): Promise<boolean>;
  readSecret(secretArn: string): Promise<string>;
  randomPassword(): string;
  prepareDatabase(options: { runtimePassword: string; resetPassword: boolean }): Promise<void>;
  storedAddressHashKeyId(): Promise<string | undefined>;
  deployStack(stackName: string): Promise<void>;
  readDeployOutputs(): Promise<DeployOutputs>;
  writeSecret(secretArn: string, value: string): Promise<'written' | 'unchanged'>;
  // `true` only on the run that inserted the bootstrap row (D8).
  insertBootstrapToken(row: ApiTokenValues): Promise<boolean>;
  insertToken(row: ApiTokenValues): Promise<void>;
  // Reads the mapping's state first and disables it only when it is not already paused.
  pauseEventSource(): Promise<void>;
};

export type RunDeployOptions = {
  env: Env;
  argv: readonly string[];
  // Built from the parsed inputs, so a step never reads the environment itself.
  steps: (config: DeployEnv) => DeploySteps;
  sink: ScriptSink;
};

const SCRIPT = 'aws:deploy';
const USAGE = 'usage: pnpm aws:deploy [--issue-operate-token <name>] [--budget-drill]';
// The bootstrap row's label (D8, `api_tokens_bootstrap_key`).
const BOOTSTRAP_TOKEN_NAME = 'bootstrap';

// A step's end: `refused` for an unsafe state, `failed` for a step that could not run. Its reason is
// one of the constants below, never an error's text.
class DeployStopped extends Error {
  readonly kind: 'refused' | 'failed';
  readonly reason: string;

  constructor(kind: 'refused' | 'failed', reason: string) {
    super(reason);
    this.name = 'DeployStopped';
    this.kind = kind;
    this.reason = reason;
  }
}

const refuse = (reason: string): DeployStopped => new DeployStopped('refused', reason);

// Runs one step; any error it throws becomes `failed: <failure>`, so no driver, SDK or CLI message
// (which can hold a URL, a password or an account id) reaches the output.
async function step<T>(failure: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof DeployStopped) throw error;
    throw new DeployStopped('failed', failure);
  }
}

type DeployArgs = { issueOperateToken: string | undefined; budgetDrill: boolean };

function parseDeployArgs(argv: readonly string[]): DeployArgs {
  let values: { 'issue-operate-token'?: string | undefined; 'budget-drill'?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'issue-operate-token': { type: 'string' },
        'budget-drill': { type: 'boolean' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw refuse(USAGE);
  }
  const name = values['issue-operate-token'];
  // D21's token-name rule, so a name the API would refuse is never inserted here either.
  if (name !== undefined && !tokenNamePattern.test(name)) {
    throw refuse(
      "the --issue-operate-token name must be 1 to 64 characters from A-Z, a-z, 0-9, '.', '_' and '-', starting with a letter or digit",
    );
  }
  return { issueOperateToken: name, budgetDrill: values['budget-drill'] === true };
}

// D33 step 6: the runtime role's password the stored `ledger/database` value carries, or `undefined`
// when the value does not parse (CDK's generated placeholder before the first write).
export function storedRuntimePassword(secretValue: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretValue);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('pooledUrl' in parsed)) return undefined;
  const { pooledUrl } = parsed;
  if (typeof pooledUrl !== 'string' || !URL.canParse(pooledUrl)) return undefined;
  const url = new URL(pooledUrl);
  if (url.username !== RUNTIME_ROLE || url.password === '') return undefined;
  return decodeURIComponent(url.password);
}

const HEX_KEY = /^[0-9a-f]{64}$/;

// D33 step 6: the id of the token tag key the stored `ledger/database` value carries, or `undefined`
// when the value does not parse or holds no such key (CDK's placeholder before the first write).
// Only the id leaves this function, never the key.
export function storedTokenTagKeyId(secretValue: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretValue);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || !('tokenTagKey' in parsed)) return undefined;
  const { tokenTagKey } = parsed;
  if (typeof tokenTagKey !== 'string' || !HEX_KEY.test(tokenTagKey)) return undefined;
  return tokenTagKeyId(hexBytes(tokenTagKey));
}

// D33 step 9: the owner's pooled URL with the runtime role's credentials swapped in and TLS required.
export function runtimePooledUrl(ownerPooledUrl: string, runtimePassword: string): string {
  const url = new URL(ownerPooledUrl);
  url.username = RUNTIME_ROLE;
  url.password = runtimePassword;
  url.searchParams.set('sslmode', 'require');
  return url.toString();
}

const hexBytes = (hex: string): Uint8Array => new Uint8Array(Buffer.from(hex, 'hex'));

export async function runDeploy({ env, argv, steps, sink }: RunDeployOptions): Promise<0 | 1> {
  const out = createScriptOutput(SCRIPT, sink);

  let config: DeployEnv;
  try {
    config = loadConfig(deployEnvSchema, env);
  } catch (error) {
    const [issue] = error instanceof ConfigError ? error.issues : [];
    if (issue === undefined) return out.failed('reading the deploy inputs failed');
    // A list variable's issue path ends in an index (`LEDGER_DEPLOY_WEBHOOK_SECRETS.1`).
    const [variable] = issue.variable.split('.');
    return out.refused(`${variable} ${issue.expected}`);
  }

  try {
    const args = parseDeployArgs(argv);
    await deploy(config, args, steps(config), out);
    return out.done();
  } catch (error) {
    if (error instanceof DeployStopped) {
      return error.kind === 'refused' ? out.refused(error.reason) : out.failed(error.reason);
    }
    return out.failed('unexpected error');
  }
}

async function deploy(
  config: DeployEnv,
  args: DeployArgs,
  steps: DeploySteps,
  out: ScriptOutput,
): Promise<void> {
  // 1. A clean tree, so `DeployedCommit` names the code deployed.
  if (!(await step('reading the git working tree failed', () => steps.isTreeClean()))) {
    throw refuse(
      'the working tree has tracked changes; commit them so DeployedCommit names the code deployed',
    );
  }

  // 2. The deployed stacks: refuse a tripped stack, record a paused event source.
  const state = await step('reading the deployed stacks failed', () => steps.readDeployedState());
  const app = state.app;
  if (app?.workerReservedConcurrency === 0) {
    throw refuse(
      "the kill switch has tripped the stack (the worker's reserved concurrency reads 0); run pnpm aws:rearm first",
    );
  }
  const pausedBefore = app?.eventSourcePaused === true;
  if (pausedBefore) out.line("the worker's event source is paused; the deploy leaves it paused");

  // 3. CBL-16: never disarm an armed kill switch by omission.
  if (state.killSwitchArmed === true && !config.killSwitch) {
    throw refuse(
      'the deploy would disarm the armed kill switch; set LEDGER_KILL_SWITCH=on (CBL-16)',
    );
  }

  // 4. ADR-018: a contract step runs only once the code running now has stopped using its object,
  // that is, once its commit is an ancestor of the deployed `DeployedCommit`. Skipped with no app
  // stack: no previous Lambda runs to break.
  if (app === undefined) {
    out.line('no app stack is deployed; the contract-step check is skipped');
  } else {
    const pending = await step('reading the pending migrations failed', () =>
      steps.pendingContractSteps(),
    );
    for (const contractStep of pending) {
      const safe = await step('git merge-base failed', () =>
        steps.isAncestor(contractStep.commit, app.deployedCommit),
      );
      if (!safe) {
        out.line(
          `pending migration ${contractStep.tag} is a contract step the deployed code may still need`,
        );
        throw refuse(
          "a pending contract step's commit is not an ancestor of the deployed DeployedCommit; deploy the commit that stopped using the object first (ADR-018)",
        );
      }
    }
  }

  // 5. Synthesize with the deploy's context, then CBL-01's scan of the result.
  const commit = await step('reading HEAD failed', () => steps.headCommit());
  out.line('synthesizing both stacks');
  await step('cdk synth failed', () =>
    steps.synthesize({
      commit,
      alertEmail: config.alertEmail,
      budgetUsd: config.budgetUsd,
      killSwitch: config.killSwitch,
      budgetDrill: args.budgetDrill,
    }),
  );
  if (await step('scanning cdk.out failed', () => steps.findTemplateSecret())) {
    throw refuse(
      "the synthesized output matches CBL-01's secret pattern; no secret value may pass through CDK",
    );
  }

  // 6. The runtime role, its timeouts and the migrations, over the direct URL. The stored password
  // is reused while the secret parses; otherwise a new one is set, and no running function can hold
  // a working connection then, because the secret it would read does not parse. First, a tag key
  // whose id differs from the deployed one's refuses: written in step 9, it would fail every stored
  // token's tag check (D3), the bootstrap one included, and step 10 issues no second bootstrap token.
  let runtimePassword: string | undefined;
  if (app !== undefined) {
    const stored = await step('reading the ledger/database secret failed', () =>
      steps.readSecret(app.databaseSecretArn),
    );
    const deployedTagKeyId = storedTokenTagKeyId(stored);
    if (
      deployedTagKeyId !== undefined &&
      deployedTagKeyId !== tokenTagKeyId(hexBytes(config.tokenTagKey))
    ) {
      throw refuse(
        "LEDGER_TOKEN_TAG_KEY's key id differs from the deployed ledger/database secret's; every stored token would fail its tag check, so restore the deployed LEDGER_TOKEN_TAG_KEY in .env.local",
      );
    }
    runtimePassword = storedRuntimePassword(stored);
  }
  const resetPassword = runtimePassword === undefined;
  const password = runtimePassword ?? steps.randomPassword();
  out.line('migrating the database');
  await step('migrating the database failed (runtime role, its timeouts or migrations)', () =>
    steps.prepareDatabase({ runtimePassword: password, resetPassword }),
  );

  // 7. data-modeling.md → PII & retention: a new key would orphan every stored hash.
  const storedKeyId = await step('reading the stored address hashes failed', () =>
    steps.storedAddressHashKeyId(),
  );
  if (
    storedKeyId !== undefined &&
    storedKeyId !== addressHashKeyId(hexBytes(config.addressHashKey))
  ) {
    throw refuse(
      "LEDGER_ADDRESS_HASH_KEY's key_id differs from the stored address hashes' key_id; deploy with the key they were made under",
    );
  }

  // 8–10, then 11 whenever 8 started, also when a later step failed: a rolled-back update may
  // re-apply `Enabled: true` too (AWS-U09).
  let stopped: unknown;
  let outputs: DeployOutputs | undefined;
  try {
    outputs = await deployAndWrite(config, args, password, steps, out);
  } catch (error) {
    stopped = error;
  }
  if (pausedBefore) {
    try {
      await steps.pauseEventSource();
      out.line("the worker's event source is paused, as before the deploy");
    } catch {
      if (stopped instanceof DeployStopped)
        out.line(`${stopped.kind} before that: ${stopped.reason}`);
      throw new DeployStopped(
        'failed',
        "re-pausing the worker's event source failed; it was paused before the deploy (AWS-U09)",
      );
    }
  }
  if (stopped !== undefined) throw stopped;
  if (outputs === undefined) throw new DeployStopped('failed', 'unexpected error');

  // 12. Where to point the webhook and the CLI.
  const apiUrl = outputs.apiUrl.replace(/\/+$/, '');
  out.line(`api url ${apiUrl}`);
  out.line(`ingest url ${apiUrl}/webhooks/resend`);
  out.line(`KillSwitchArmed ${outputs.killSwitchArmed}`);
}

async function deployAndWrite(
  config: DeployEnv,
  args: DeployArgs,
  runtimePassword: string,
  steps: DeploySteps,
  out: ScriptOutput,
): Promise<DeployOutputs> {
  // 8. Guardrails first (aws.md → Budget alarms item 1), then the app.
  for (const stackName of [GUARDRAILS_STACK_NAME, APP_STACK_NAME]) {
    out.line(`deploying ${stackName}`);
    await step(`cdk deploy ${stackName} failed`, () => steps.deployStack(stackName));
  }
  const outputs = await step("reading the deployed stacks' outputs failed", () =>
    steps.readDeployOutputs(),
  );

  // 9. The secret values, written by this command only (CBL-01), each only when it changed.
  const database = JSON.stringify({
    pooledUrl: runtimePooledUrl(config.pooledDatabaseUrl, runtimePassword),
    addressHashKey: config.addressHashKey,
    tokenTagKey: config.tokenTagKey,
  });
  const databaseWrite = await step('writing ledger/database failed', () =>
    steps.writeSecret(outputs.databaseSecretArn, database),
  );
  out.line(`ledger/database ${databaseWrite}`);
  const webhookSecrets = config.webhookSecrets;
  if (webhookSecrets === undefined) {
    out.line(
      'LEDGER_DEPLOY_WEBHOOK_SECRETS is unset; ledger/webhook-signing-secrets keeps its stored value',
    );
  } else {
    const signingWrite = await step('writing ledger/webhook-signing-secrets failed', () =>
      steps.writeSecret(outputs.signingSecretsArn, JSON.stringify(webhookSecrets)),
    );
    out.line(`ledger/webhook-signing-secrets ${signingWrite}`);
  }

  // 10. The first `operate` token, printed once: only by the run that inserted it (D8).
  const tagKey = hexBytes(config.tokenTagKey);
  const bootstrap = mintApiToken(tagKey);
  const inserted = await step('inserting the bootstrap token failed', () =>
    steps.insertBootstrapToken({
      name: BOOTSTRAP_TOKEN_NAME,
      tokenHash: bootstrap.tokenHash,
      scope: 'operate',
    }),
  );
  if (inserted) {
    out.line(`bootstrap operate token (shown once; store it now): ${bootstrap.token}`);
  }
  const extraName = args.issueOperateToken;
  if (extraName !== undefined) {
    const extra = mintApiToken(tagKey);
    await step('inserting the operate token failed', () =>
      steps.insertToken({ name: extraName, tokenHash: extra.tokenHash, scope: 'operate' }),
    );
    out.line(`operate token ${extraName} (shown once; store it now): ${extra.token}`);
  }
  return outputs;
}
