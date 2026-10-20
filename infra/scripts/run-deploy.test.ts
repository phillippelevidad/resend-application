// Ships 5, Ships 9, R13, R14 (D33): the deploy command's input assertion, its refusals, its order
// and its token printing, over fake steps that hold the state a real deploy reads and writes. The
// unsafe-contract-step case runs the real `git merge-base` over a throwaway repository.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addressHashKeyId } from '@ledger/core';
import type { ApiTokenValues, ContractStep } from '@ledger/db';
import { hashApiToken, hasValidTag, tokenTagKeyId } from '@ledger/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAncestor } from './git.ts';
import {
  type DeployContext,
  type DeployedState,
  type DeploySteps,
  runDeploy,
  runtimePooledUrl,
  storedRuntimePassword,
  storedTokenTagKeyId,
} from './run-deploy.ts';
import type { ScriptSink } from './script-output.ts';

// Fake values, each distinctive, so the no-secret check can search every output line for them.
const OWNER_DIRECT_PASSWORD = 'fakeOwnerDirectPw1';
const OWNER_POOLED_PASSWORD = 'fakeOwnerPooledPw2';
const STORED_RUNTIME_PASSWORD = 'fakestoredruntimepw3';
const NEW_RUNTIME_PASSWORD = 'fakenewruntimepw4';
const ADDRESS_HASH_KEY = '1a'.repeat(32);
const TOKEN_TAG_KEY = '2b'.repeat(32);
// The tag key a deployed `ledger/database` secret holds when `.env.local` was given a new one.
const DEPLOYED_OTHER_TAG_KEY = '3c'.repeat(32);
// The secret-shaped fixtures are built at run time, so no `whsec_` or credentialed Postgres URL
// literal sits in the source (the gitleaks rules).
const WEBHOOK_SECRET = `whsec_${Buffer.from('fakeWebhookSecret5').toString('base64')}`;
const SIMULATOR_SECRET = `whsec_${Buffer.from('fakeSimulatorSecret6').toString('base64')}`;
// Not RS-02's form, so `LEDGER_SIMULATOR=on` refuses it; the refusal must not echo it either.
const MALFORMED_SIMULATOR_SECRET = 'fakeMalformedSimulatorSecret7';
const ALERT_EMAIL = 'delivered@resend.dev';
// Slice 4 D29: a key of the `re_` form, below the gitleaks rule's 20 characters, and a webhook id.
const RESEND_API_KEY = 're_fakeReconciler10';
const RESEND_WEBHOOK_ID = 'wh_fake_ledger';
const databaseUrl = (scheme: string, password: string, host: string) =>
  `${scheme}://owner:${password}@${host}/ledger`;
const DIRECT_URL = databaseUrl('postgres', OWNER_DIRECT_PASSWORD, 'direct.db.invalid');
const POOLED_URL = databaseUrl('postgresql', OWNER_POOLED_PASSWORD, 'pooler.db.invalid');
const SECRETS = [
  OWNER_DIRECT_PASSWORD,
  OWNER_POOLED_PASSWORD,
  STORED_RUNTIME_PASSWORD,
  NEW_RUNTIME_PASSWORD,
  ADDRESS_HASH_KEY,
  TOKEN_TAG_KEY,
  DEPLOYED_OTHER_TAG_KEY,
  WEBHOOK_SECRET,
  SIMULATOR_SECRET,
  MALFORMED_SIMULATOR_SECRET,
  ALERT_EMAIL,
  RESEND_API_KEY,
];

const DEPLOYED_COMMIT = 'a'.repeat(40);
const DATABASE_SECRET_ARN = 'fake-database-secret';
const SIGNING_SECRETS_ARN = 'fake-signing-secrets';
const SIMULATOR_SECRET_ARN = 'fake-simulator-secret';
const RESEND_API_KEY_SECRET_ARN = 'fake-resend-api-key';
const KEY_ID = addressHashKeyId(new Uint8Array(Buffer.from(ADDRESS_HASH_KEY, 'hex')));

const baseEnv = {
  LEDGER_DEPLOY_DATABASE_URL: DIRECT_URL,
  LEDGER_DEPLOY_DATABASE_POOLED_URL: POOLED_URL,
  LEDGER_ALERT_EMAIL: ALERT_EMAIL,
  LEDGER_ADDRESS_HASH_KEY: ADDRESS_HASH_KEY,
  LEDGER_TOKEN_TAG_KEY: TOKEN_TAG_KEY,
  LEDGER_DEPLOY_WEBHOOK_SECRETS: WEBHOOK_SECRET,
  LEDGER_KILL_SWITCH: 'on',
  // Slice 4 D29: with the signing secrets set, both are required.
  LEDGER_DEPLOY_RESEND_API_KEY: RESEND_API_KEY,
  LEDGER_DEPLOY_RESEND_WEBHOOK_ID: RESEND_WEBHOOK_ID,
};

const databaseSecret = (tokenTagKey: string) =>
  JSON.stringify({
    pooledUrl: runtimePooledUrl(POOLED_URL, STORED_RUNTIME_PASSWORD),
    addressHashKey: ADDRESS_HASH_KEY,
    tokenTagKey,
  });
const storedDatabaseSecret = databaseSecret(TOKEN_TAG_KEY);

// A world whose deployed `ledger/database` secret holds another tag key than the one given.
const withDeployedOtherTagKey = (): World => {
  const world = newWorld();
  world.secrets.set(DATABASE_SECRET_ARN, databaseSecret(DEPLOYED_OTHER_TAG_KEY));
  return world;
};

// What the fake installation holds: the stacks, the database and the secrets.
type World = {
  calls: string[];
  treeClean: boolean;
  appDeployed: boolean;
  workerReservedConcurrency: number | null;
  eventSourcePaused: boolean;
  killSwitchArmed: boolean | undefined;
  pending: ContractStep[];
  isAncestor: (sha: string, deployedCommit: string) => boolean;
  templateSecret: boolean;
  storedKeyId: string | undefined;
  secrets: Map<string, string>;
  bootstrapRows: number;
  tokens: ApiTokenValues[];
  failingStack: string | undefined;
  prepared: { runtimePassword: string; resetPassword: boolean } | undefined;
  // The context the last synth was given; the app stack has `SimulatorSecretArn` only when it set
  // the simulator flag (D12), unless `simulatorOutputMissing` drops it.
  synthesized: DeployContext | undefined;
  simulatorOutputMissing: boolean;
};

const newWorld = (overrides: Partial<World> = {}): World => ({
  calls: [],
  treeClean: true,
  appDeployed: true,
  workerReservedConcurrency: null,
  eventSourcePaused: false,
  killSwitchArmed: true,
  pending: [],
  isAncestor: () => true,
  templateSecret: false,
  storedKeyId: KEY_ID,
  secrets: new Map([
    [DATABASE_SECRET_ARN, storedDatabaseSecret],
    [SIGNING_SECRETS_ARN, 'cdk-generated-placeholder'],
  ]),
  bootstrapRows: 0,
  tokens: [],
  failingStack: undefined,
  prepared: undefined,
  synthesized: undefined,
  simulatorOutputMissing: false,
  ...overrides,
});

function fakeSteps(world: World): DeploySteps {
  const call = (name: string) => world.calls.push(name);
  return {
    async isTreeClean() {
      call('isTreeClean');
      return world.treeClean;
    },
    async headCommit() {
      call('headCommit');
      return 'c'.repeat(40);
    },
    async readDeployedState(): Promise<DeployedState> {
      call('readDeployedState');
      return {
        app: world.appDeployed
          ? {
              deployedCommit: DEPLOYED_COMMIT,
              workerReservedConcurrency: world.workerReservedConcurrency,
              eventSourcePaused: world.eventSourcePaused,
              databaseSecretArn: DATABASE_SECRET_ARN,
            }
          : undefined,
        killSwitchArmed: world.killSwitchArmed,
      };
    },
    async pendingContractSteps() {
      call('pendingContractSteps');
      return world.pending;
    },
    async isAncestor(sha, deployedCommit) {
      call('isAncestor');
      return world.isAncestor(sha, deployedCommit);
    },
    async synthesize(context) {
      call('synthesize');
      world.synthesized = context;
    },
    async findTemplateSecret() {
      call('findTemplateSecret');
      return world.templateSecret;
    },
    async readSecret(secretArn) {
      call('readSecret');
      const value = world.secrets.get(secretArn);
      if (value === undefined) throw new Error('ResourceNotFoundException');
      return value;
    },
    randomPassword() {
      return NEW_RUNTIME_PASSWORD;
    },
    async prepareDatabase(options) {
      call('prepareDatabase');
      world.prepared = options;
    },
    async storedAddressHashKeyId() {
      call('storedAddressHashKeyId');
      return world.storedKeyId;
    },
    async deployStack(stackName) {
      call(`deployStack:${stackName}`);
      if (stackName === 'LedgerApp') {
        // A stack update can re-apply the mapping's `Enabled: true` (AWS-U09), also when it fails.
        world.eventSourcePaused = false;
        world.appDeployed = true;
      }
      if (stackName === world.failingStack) throw new Error('cdk deploy exited 1');
    },
    async readDeployOutputs() {
      call('readDeployOutputs');
      return {
        apiUrl: 'https://api.example.invalid/',
        databaseSecretArn: DATABASE_SECRET_ARN,
        signingSecretsArn: SIGNING_SECRETS_ARN,
        simulatorSecretArn:
          world.synthesized?.simulator === true && !world.simulatorOutputMissing
            ? SIMULATOR_SECRET_ARN
            : undefined,
        resendApiKeySecretArn: RESEND_API_KEY_SECRET_ARN,
        killSwitchArmed: true,
      };
    },
    async writeSecret(secretArn, value) {
      call(`writeSecret:${secretArn}`);
      if (world.secrets.get(secretArn) === value) return 'unchanged';
      world.secrets.set(secretArn, value);
      return 'written';
    },
    async insertBootstrapToken(row) {
      call('insertBootstrapToken');
      if (world.bootstrapRows > 0) return false;
      world.bootstrapRows += 1;
      world.tokens.push(row);
      return true;
    },
    async insertToken(row) {
      call('insertToken');
      world.tokens.push(row);
    },
    async pauseEventSource() {
      call('pauseEventSource');
      world.eventSourcePaused = true;
    },
  };
}

type Run = { code: 0 | 1; lines: string[]; stderr: string[]; stepsBuilt: boolean };

async function deploy(
  world: World,
  { env = baseEnv, argv = [] }: { env?: Record<string, string>; argv?: string[] } = {},
): Promise<Run> {
  const lines: string[] = [];
  const stderr: string[] = [];
  let stepsBuilt = false;
  const sink: ScriptSink = (stream, text) => {
    lines.push(text);
    if (stream === 'stderr') stderr.push(text);
  };
  const code = await runDeploy({
    env,
    argv,
    steps: () => {
      stepsBuilt = true;
      return fakeSteps(world);
    },
    sink,
  });
  return { code, lines, stderr, stepsBuilt };
}

const lastLine = (run: Run): string => run.lines.at(-1) ?? '';
const tokensPrinted = (run: Run): string[] =>
  run.lines.flatMap((line) => line.match(/ldg_[0-9a-f]{64}_[0-9a-f]{64}/g) ?? []);

// Every step that changes a database, a stack or a secret.
const CHANGES = [
  'prepareDatabase',
  'deployStack:LedgerGuardrails',
  'deployStack:LedgerApp',
  `writeSecret:${DATABASE_SECRET_ARN}`,
  `writeSecret:${SIGNING_SECRETS_ARN}`,
  `writeSecret:${SIMULATOR_SECRET_ARN}`,
  'insertBootstrapToken',
  'insertToken',
];

const expectNoChange = (world: World) => {
  for (const change of CHANGES) expect(world.calls).not.toContain(change);
};

describe('the input assertion', () => {
  it.each([
    ['LEDGER_DEPLOY_DATABASE_URL', { LEDGER_DEPLOY_DATABASE_URL: undefined }],
    ['LEDGER_DEPLOY_DATABASE_URL', { LEDGER_DEPLOY_DATABASE_URL: 'mysql://db.invalid/ledger' }],
    ['LEDGER_DEPLOY_DATABASE_POOLED_URL', { LEDGER_DEPLOY_DATABASE_POOLED_URL: '' }],
    ['LEDGER_DEPLOY_DATABASE_POOLED_URL', { LEDGER_DEPLOY_DATABASE_POOLED_URL: 'not a url' }],
    ['LEDGER_ALERT_EMAIL', { LEDGER_ALERT_EMAIL: undefined }],
    ['LEDGER_DEPLOY_WEBHOOK_SECRETS', { LEDGER_DEPLOY_WEBHOOK_SECRETS: `${WEBHOOK_SECRET},nope` }],
    ['LEDGER_KILL_SWITCH', { LEDGER_KILL_SWITCH: 'yes' }],
    ['LEDGER_BUDGET_USD', { LEDGER_BUDGET_USD: '-5' }],
    ['LEDGER_SIMULATOR', { LEDGER_SIMULATOR: 'yes' }],
    // D11: with `on`, a missing, empty or malformed simulator value refuses before any AWS call.
    ['LEDGER_SIMULATOR_SECRET', { LEDGER_SIMULATOR: 'on' }],
    ['LEDGER_SIMULATOR_SECRET', { LEDGER_SIMULATOR: 'on', LEDGER_SIMULATOR_SECRET: '' }],
    [
      'LEDGER_SIMULATOR_SECRET',
      { LEDGER_SIMULATOR: 'on', LEDGER_SIMULATOR_SECRET: MALFORMED_SIMULATOR_SECRET },
    ],
  ])('refuses naming %s before any step runs', async (variable, change) => {
    const world = newWorld();
    const env = Object.fromEntries(
      Object.entries({ ...baseEnv, ...change }).filter(([, value]) => value !== undefined),
    ) as Record<string, string>;
    const run = await deploy(world, { env });
    expect(run.code).toBe(1);
    expect(lastLine(run)).toMatch(new RegExp(`^aws:deploy: refused: ${variable} `));
    expect(run.stepsBuilt).toBe(false);
    expect(world.calls).toEqual([]);
  });

  it.each([
    ['LEDGER_ADDRESS_HASH_KEY', undefined],
    ['LEDGER_ADDRESS_HASH_KEY', 'AB'.repeat(32)],
    ['LEDGER_TOKEN_TAG_KEY', undefined],
    ['LEDGER_TOKEN_TAG_KEY', 'abc'],
  ])(
    'refuses a missing or malformed %s, naming pnpm db:setup and generating nothing',
    async (variable, value) => {
      const world = newWorld();
      const env: Record<string, string> = { ...baseEnv };
      if (value === undefined) delete env[variable];
      else env[variable] = value;
      const run = await deploy(world, { env });
      expect(run.code).toBe(1);
      expect(lastLine(run)).toMatch(
        new RegExp(`^aws:deploy: refused: ${variable} .*pnpm db:setup`),
      );
      expect(world.calls).toEqual([]);
    },
  );

  it('names the first missing variable when none is set', async () => {
    const run = await deploy(newWorld(), { env: {} });
    expect(run.lines).toEqual([
      "aws:deploy: refused: LEDGER_DEPLOY_DATABASE_URL must be set to the database's direct postgres:// URL, owner credentials\n",
    ]);
  });

  it('refuses an unknown flag and a malformed --issue-operate-token name before any step', async () => {
    for (const argv of [['--force'], ['--issue-operate-token', 'bad name!']]) {
      const world = newWorld();
      const run = await deploy(world, { argv });
      expect(run.code).toBe(1);
      expect(lastLine(run)).toMatch(/^aws:deploy: refused: /);
      expect(world.calls).toEqual([]);
    }
  });
});

describe('the refusals before any change', () => {
  it('refuses a working tree with tracked changes and runs no later step', async () => {
    const world = newWorld({ treeClean: false });
    const run = await deploy(world);
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: the working tree has tracked changes/);
    expect(run.code).toBe(1);
    expect(world.calls).toEqual(['isTreeClean']);
  });

  it('refuses a tripped stack, naming pnpm aws:rearm, before the next step and any migration', async () => {
    const world = newWorld({ workerReservedConcurrency: 0 });
    const run = await deploy(world);
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: .*pnpm aws:rearm/);
    expect(run.code).toBe(1);
    expect(world.calls).toEqual(['isTreeClean', 'readDeployedState']);
    expectNoChange(world);
  });

  it('refuses a deploy that would disarm an armed kill switch (CBL-16)', async () => {
    const world = newWorld({ killSwitchArmed: true });
    const run = await deploy(world, { env: { ...baseEnv, LEDGER_KILL_SWITCH: 'off' } });
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: the deploy would disarm/);
    expect(run.code).toBe(1);
    expect(world.calls).toEqual(['isTreeClean', 'readDeployedState']);
    expectNoChange(world);
  });

  // CBL-16's named risk is the disarm by omission: a redeploy from a shell with no
  // LEDGER_KILL_SWITCH at all.
  it('refuses the same disarm when LEDGER_KILL_SWITCH is unset', async () => {
    const world = newWorld({ killSwitchArmed: true });
    const { LEDGER_KILL_SWITCH: _omitted, ...env } = baseEnv;
    const run = await deploy(world, { env });
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: the deploy would disarm/);
    expect(run.code).toBe(1);
    expect(world.calls).toEqual(['isTreeClean', 'readDeployedState']);
    expectNoChange(world);
  });

  it('allows a disarmed stack to stay disarmed', async () => {
    const world = newWorld({ killSwitchArmed: false });
    const run = await deploy(world, { env: { ...baseEnv, LEDGER_KILL_SWITCH: 'off' } });
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });

  it('refuses a CBL-01 hit in the synthesized output before migrating', async () => {
    const world = newWorld({ templateSecret: true });
    const run = await deploy(world);
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: .*CBL-01/);
    expect(run.code).toBe(1);
    expect(world.calls.at(-1)).toBe('findTemplateSecret');
    expectNoChange(world);
  });
});

describe('the contract-step refusal over a throwaway git repository (ADR-018)', () => {
  let repo: string;
  const commits: Record<'deployed' | 'contract' | 'head', string> = {
    deployed: '',
    contract: '',
    head: '',
  };
  const git = (...args: string[]): string => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'user.name=ledger-test',
        '-c',
        'user.email=delivered@resend.dev',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
    return result.stdout.trim();
  };

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'ledger-run-deploy-git-'));
    git('init', '--quiet');
    for (const name of ['deployed', 'contract', 'head'] as const) {
      git('commit', '--quiet', '--allow-empty', '-m', name);
      commits[name] = git('rev-parse', 'HEAD');
    }
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const withRepo = (deployedCommit: string, overrides: Partial<World> = {}) =>
    newWorld({
      pending: [{ tag: '0004_drop-old-column', commit: commits.contract }],
      isAncestor: (sha) => isAncestor(repo, sha, deployedCommit),
      ...overrides,
    });

  it('refuses a contract step whose commit is an ancestor of HEAD but not of the deployed commit', async () => {
    const world = withRepo(commits.deployed);
    const run = await deploy(world);
    expect(isAncestor(repo, commits.contract, commits.head)).toBe(true);
    expect(lastLine(run)).toMatch(
      /^aws:deploy: refused: .*not an ancestor of the deployed DeployedCommit/,
    );
    expect(world.calls).not.toContain('synthesize');
    expectNoChange(world);
  });

  it('refuses a contract step whose commit git does not know', async () => {
    const world = newWorld({
      pending: [{ tag: '0004_drop-old-column', commit: 'f'.repeat(40) }],
      isAncestor: (sha) => isAncestor(repo, sha, commits.head),
    });
    const run = await deploy(world);
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: /);
    expectNoChange(world);
  });

  it('continues once the deployed commit has the contract step as an ancestor', async () => {
    const world = withRepo(commits.head);
    const run = await deploy(world);
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });

  it('skips the check on a first deploy, with no app stack', async () => {
    const world = withRepo(commits.deployed, { appDeployed: false, killSwitchArmed: undefined });
    const run = await deploy(world);
    expect(world.calls).not.toContain('pendingContractSteps');
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });
});

describe('the key_id refusal', () => {
  it('follows the migration and precedes every stack deploy and secret write', async () => {
    const world = newWorld({ storedKeyId: '0badc0de' });
    const run = await deploy(world);
    expect(lastLine(run)).toMatch(/^aws:deploy: refused: LEDGER_ADDRESS_HASH_KEY's key_id differs/);
    expect(world.calls).toContain('prepareDatabase');
    expect(world.calls.at(-1)).toBe('storedAddressHashKeyId');
    expect(world.calls.filter((name) => /deployStack|writeSecret|insert/.test(name))).toEqual([]);
  });

  it('passes on a database that holds no hash', async () => {
    const run = await deploy(newWorld({ storedKeyId: undefined }));
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });
});

// A new LEDGER_TOKEN_TAG_KEY written into ledger/database would fail every stored token's tag
// check, the bootstrap one included, and the deploy would print no new one (D33 step 6).
describe('the token tag key refusal', () => {
  it('refuses a tag key whose id differs from the deployed one, before migrating and any stack or secret write', async () => {
    const world = withDeployedOtherTagKey();
    const run = await deploy(world);
    expect(run.code).toBe(1);
    expect(lastLine(run)).toBe(
      "aws:deploy: refused: LEDGER_TOKEN_TAG_KEY's key id differs from the deployed ledger/database secret's; every stored token would fail its tag check, so restore the deployed LEDGER_TOKEN_TAG_KEY in .env.local\n",
    );
    expect(world.calls.at(-1)).toBe('readSecret');
    expectNoChange(world);
    expect(world.secrets.get(DATABASE_SECRET_ARN)).toBe(databaseSecret(DEPLOYED_OTHER_TAG_KEY));
  });

  it('passes the tag key the deployed secret holds', async () => {
    const world = newWorld();
    const run = await deploy(world);
    expect(lastLine(run)).toBe('aws:deploy: done\n');
    expect(world.calls).toContain('prepareDatabase');
  });

  it('passes a first deploy, with no app stack and so no deployed tag key', async () => {
    const world = newWorld({ appDeployed: false, killSwitchArmed: undefined });
    world.secrets.set(DATABASE_SECRET_ARN, databaseSecret(DEPLOYED_OTHER_TAG_KEY));
    const run = await deploy(world);
    expect(world.calls).not.toContain('readSecret');
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });

  it("passes a deployed secret that still holds CDK's placeholder", async () => {
    const world = newWorld();
    world.secrets.set(DATABASE_SECRET_ARN, 'cdk-generated-placeholder');
    const run = await deploy(world);
    expect(lastLine(run)).toBe('aws:deploy: done\n');
  });

  it('reads the id of the stored tag key only from a stored value that holds a 64-hex one', () => {
    const tagKeyId = (hex: string) => tokenTagKeyId(new Uint8Array(Buffer.from(hex, 'hex')));
    expect(storedTokenTagKeyId(databaseSecret(TOKEN_TAG_KEY))).toBe(tagKeyId(TOKEN_TAG_KEY));
    expect(storedTokenTagKeyId(databaseSecret(DEPLOYED_OTHER_TAG_KEY))).not.toBe(
      tagKeyId(TOKEN_TAG_KEY),
    );
    expect(storedTokenTagKeyId('cdk-generated-placeholder')).toBeUndefined();
    expect(storedTokenTagKeyId(JSON.stringify({ pooledUrl: POOLED_URL }))).toBeUndefined();
    expect(storedTokenTagKeyId(databaseSecret('not-hex'))).toBeUndefined();
    expect(storedTokenTagKeyId('null')).toBeUndefined();
  });
});

describe('the order and what a deploy writes', () => {
  it('runs every step in D33 order, the guardrails stack before the app stack', async () => {
    const world = newWorld();
    const run = await deploy(world);
    expect(run.code).toBe(0);
    expect(world.calls).toEqual([
      'isTreeClean',
      'readDeployedState',
      'pendingContractSteps',
      'headCommit',
      'synthesize',
      'findTemplateSecret',
      'readSecret',
      'prepareDatabase',
      'storedAddressHashKeyId',
      'deployStack:LedgerGuardrails',
      'deployStack:LedgerApp',
      'readDeployOutputs',
      `writeSecret:${DATABASE_SECRET_ARN}`,
      `writeSecret:${SIGNING_SECRETS_ARN}`,
      // Slice 4 D29: the reconciler's key, after the stacks and the other secrets.
      `writeSecret:${RESEND_API_KEY_SECRET_ARN}`,
      'insertBootstrapToken',
    ]);
    expect(run.lines.slice(-5)).toEqual([
      'aws:deploy: api url https://api.example.invalid\n',
      'aws:deploy: ingest url https://api.example.invalid/webhooks/resend\n',
      'aws:deploy: KillSwitchArmed true\n',
      'aws:deploy: simulator off\n',
      'aws:deploy: done\n',
    ]);
  });

  it('reuses the stored runtime password while the secret parses, and writes nothing unchanged', async () => {
    const world = newWorld();
    world.secrets.set(SIGNING_SECRETS_ARN, JSON.stringify([WEBHOOK_SECRET]));
    const run = await deploy(world);
    expect(world.prepared).toEqual({
      runtimePassword: STORED_RUNTIME_PASSWORD,
      resetPassword: false,
    });
    expect(run.lines).toContain('aws:deploy: ledger/database unchanged\n');
    expect(run.lines).toContain('aws:deploy: ledger/webhook-signing-secrets unchanged\n');
  });

  it('sets a new runtime password on a first deploy and writes both secrets', async () => {
    const world = newWorld({ appDeployed: false, killSwitchArmed: undefined });
    world.secrets.set(DATABASE_SECRET_ARN, 'cdk-generated-placeholder');
    await deploy(world);
    expect(world.prepared).toEqual({ runtimePassword: NEW_RUNTIME_PASSWORD, resetPassword: true });
    const written = JSON.parse(world.secrets.get(DATABASE_SECRET_ARN) ?? '');
    expect(written).toEqual({
      pooledUrl: runtimePooledUrl(POOLED_URL, NEW_RUNTIME_PASSWORD),
      addressHashKey: ADDRESS_HASH_KEY,
      tokenTagKey: TOKEN_TAG_KEY,
    });
    expect(storedRuntimePassword(world.secrets.get(DATABASE_SECRET_ARN) ?? '')).toBe(
      NEW_RUNTIME_PASSWORD,
    );
    expect(new URL(written.pooledUrl).searchParams.get('sslmode')).toBe('require');
    expect(world.secrets.get(SIGNING_SECRETS_ARN)).toBe(JSON.stringify([WEBHOOK_SECRET]));
  });

  it('sets a new runtime password when the stored secret does not parse', async () => {
    const world = newWorld();
    world.secrets.set(DATABASE_SECRET_ARN, 'cdk-generated-placeholder');
    await deploy(world);
    expect(world.prepared).toEqual({ runtimePassword: NEW_RUNTIME_PASSWORD, resetPassword: true });
  });

  it('fails without migrating when the stored secret cannot be read', async () => {
    const world = newWorld();
    world.secrets.delete(DATABASE_SECRET_ARN);
    const run = await deploy(world);
    expect(lastLine(run)).toBe('aws:deploy: failed: reading the ledger/database secret failed\n');
    expectNoChange(world);
  });
});

describe('the paused event source (AWS-U09)', () => {
  it('leaves a paused event source paused after the deploy', async () => {
    const world = newWorld({ eventSourcePaused: true });
    const run = await deploy(world);
    expect(run.code).toBe(0);
    expect(world.calls.at(-1)).toBe('pauseEventSource');
    expect(world.eventSourcePaused).toBe(true);
  });

  it('restores the recorded pause also when the app stack deploy fails', async () => {
    const world = newWorld({ eventSourcePaused: true, failingStack: 'LedgerApp' });
    const run = await deploy(world);
    expect(run.code).toBe(1);
    expect(lastLine(run)).toBe('aws:deploy: failed: cdk deploy LedgerApp failed\n');
    expect(world.calls.slice(-2)).toEqual(['deployStack:LedgerApp', 'pauseEventSource']);
    expect(world.eventSourcePaused).toBe(true);
  });

  it('touches an enabled event source not at all', async () => {
    const world = newWorld();
    await deploy(world);
    expect(world.calls).not.toContain('pauseEventSource');
  });
});

describe('the bootstrap token (Ships 5)', () => {
  it('prints the bootstrap operate token once, on the run that inserts it', async () => {
    const world = newWorld();
    const first = await deploy(world);
    const [token] = tokensPrinted(first);
    expect(tokensPrinted(first)).toHaveLength(1);
    expect(token).toBeDefined();
    expect(hasValidTag(token ?? '', new Uint8Array(Buffer.from(TOKEN_TAG_KEY, 'hex')))).toBe(true);
    expect(world.tokens).toEqual([
      { name: 'bootstrap', tokenHash: hashApiToken(token ?? ''), scope: 'operate' },
    ]);
    expect(first.stderr).toEqual([]);
  });

  it('inserts no second bootstrap row and prints no token on a re-run', async () => {
    const world = newWorld();
    await deploy(world);
    const rerun = await deploy(world);
    expect(rerun.code).toBe(0);
    expect(world.bootstrapRows).toBe(1);
    expect(tokensPrinted(rerun)).toEqual([]);
  });

  it('prints one more operate token with --issue-operate-token', async () => {
    const world = newWorld();
    await deploy(world);
    const run = await deploy(world, { argv: ['--issue-operate-token', 'walk-operate'] });
    const printed = tokensPrinted(run);
    expect(printed).toHaveLength(1);
    expect(world.tokens.at(-1)).toEqual({
      name: 'walk-operate',
      tokenHash: hashApiToken(printed[0] ?? ''),
      scope: 'operate',
    });
    expect(world.bootstrapRows).toBe(1);
  });
});

// Ships 3 (D11, D21): `LEDGER_SIMULATOR=on` synthesizes the simulator secret and writes its value
// after `cdk deploy`, never through the template; `off` and unset do neither.
describe('the simulator secret (Ships 3)', () => {
  const simulatorOn = {
    ...baseEnv,
    LEDGER_SIMULATOR: 'on',
    LEDGER_SIMULATOR_SECRET: SIMULATOR_SECRET,
  };

  it('passes ledger:simulator=true and writes the simulator value after both stack deploys', async () => {
    const world = newWorld();
    const run = await deploy(world, { env: simulatorOn });
    expect(run.code).toBe(0);
    expect(world.synthesized?.simulator).toBe(true);
    expect(world.secrets.get(SIMULATOR_SECRET_ARN)).toBe(SIMULATOR_SECRET);
    const write = world.calls.indexOf(`writeSecret:${SIMULATOR_SECRET_ARN}`);
    expect(write).toBeGreaterThan(world.calls.indexOf('deployStack:LedgerApp'));
    expect(write).toBeGreaterThan(world.calls.indexOf(`writeSecret:${SIGNING_SECRETS_ARN}`));
    expect(run.lines).toContain('aws:deploy: ledger/simulator-signing-secret written\n');
    expect(run.lines.slice(-3)).toEqual([
      'aws:deploy: KillSwitchArmed true\n',
      'aws:deploy: simulator on\n',
      'aws:deploy: done\n',
    ]);
  });

  it('writes nothing on a re-run with the same value', async () => {
    const world = newWorld();
    await deploy(world, { env: simulatorOn });
    const rerun = await deploy(world, { env: simulatorOn });
    expect(rerun.code).toBe(0);
    expect(rerun.lines).toContain('aws:deploy: ledger/simulator-signing-secret unchanged\n');
  });

  it.each([
    ['off', { ...baseEnv, LEDGER_SIMULATOR: 'off', LEDGER_SIMULATOR_SECRET: SIMULATOR_SECRET }],
    ['unset', baseEnv],
    ['empty', { ...baseEnv, LEDGER_SIMULATOR: '' }],
    // `.env.local` holds the local simulator value too; with `off` it is neither read nor checked.
    [
      'off with a malformed value',
      { ...baseEnv, LEDGER_SIMULATOR_SECRET: MALFORMED_SIMULATOR_SECRET },
    ],
  ])('passes ledger:simulator=false and writes no simulator secret when %s', async (_case, env) => {
    const world = newWorld();
    const run = await deploy(world, { env });
    expect(run.code).toBe(0);
    expect(world.synthesized?.simulator).toBe(false);
    expect(world.calls).not.toContain(`writeSecret:${SIMULATOR_SECRET_ARN}`);
    expect(world.secrets.has(SIMULATOR_SECRET_ARN)).toBe(false);
    expect(run.lines.slice(-2)).toEqual(['aws:deploy: simulator off\n', 'aws:deploy: done\n']);
  });

  it('fails when the app stack has no SimulatorSecretArn output after a deploy with on', async () => {
    const world = newWorld({ simulatorOutputMissing: true });
    const run = await deploy(world, { env: simulatorOn });
    expect(run.code).toBe(1);
    expect(lastLine(run)).toBe(
      'aws:deploy: failed: the app stack has no SimulatorSecretArn output after a deploy with LEDGER_SIMULATOR=on\n',
    );
    expect(world.calls).not.toContain('insertBootstrapToken');
  });
});

describe('the output', () => {
  it('holds no secret value fed in, on success or on any failure', async () => {
    const simulatorOn = { LEDGER_SIMULATOR: 'on', LEDGER_SIMULATOR_SECRET: SIMULATOR_SECRET };
    const runs = [
      await deploy(newWorld(), { env: { ...baseEnv, ...simulatorOn } }),
      await deploy(newWorld({ simulatorOutputMissing: true }), {
        env: { ...baseEnv, ...simulatorOn },
      }),
      await deploy(newWorld(), {
        env: {
          ...baseEnv,
          LEDGER_SIMULATOR: 'on',
          LEDGER_SIMULATOR_SECRET: MALFORMED_SIMULATOR_SECRET,
        },
      }),
      await deploy(newWorld(), { env: { ...baseEnv, LEDGER_SIMULATOR_SECRET: SIMULATOR_SECRET } }),
      await deploy(newWorld()),
      await deploy(newWorld({ appDeployed: false, killSwitchArmed: undefined })),
      await deploy(newWorld({ storedKeyId: '0badc0de' })),
      await deploy(withDeployedOtherTagKey()),
      await deploy(newWorld({ eventSourcePaused: true, failingStack: 'LedgerApp' })),
      await deploy(newWorld(), { argv: ['--issue-operate-token', 'walk-operate'] }),
    ];
    for (const run of runs) {
      for (const line of run.lines) {
        expect(line).toMatch(/^aws:deploy: /);
        for (const secret of SECRETS) expect(line).not.toContain(secret);
        expect(line).not.toMatch(/postgres(ql)?:\/\//);
      }
    }
  });
});

// Slice 4 D29: the reconciler's two deploy inputs, refused before any AWS call unless both or
// neither are set (and both whenever the signing secrets are), the webhook id as CDK context, and the
// key written after `cdk deploy`.
describe("the reconciler's Resend inputs (slice 4 D29)", () => {
  const without = (...names: string[]) =>
    Object.fromEntries(Object.entries(baseEnv).filter(([name]) => !names.includes(name))) as Record<
      string,
      string
    >;

  it.each([
    [
      'LEDGER_DEPLOY_RESEND_WEBHOOK_ID',
      without('LEDGER_DEPLOY_RESEND_WEBHOOK_ID', 'LEDGER_DEPLOY_WEBHOOK_SECRETS'),
    ],
    [
      'LEDGER_DEPLOY_RESEND_API_KEY',
      without('LEDGER_DEPLOY_RESEND_API_KEY', 'LEDGER_DEPLOY_WEBHOOK_SECRETS'),
    ],
    [
      'LEDGER_DEPLOY_RESEND_API_KEY',
      without('LEDGER_DEPLOY_RESEND_API_KEY', 'LEDGER_DEPLOY_RESEND_WEBHOOK_ID'),
    ],
    ['LEDGER_DEPLOY_RESEND_WEBHOOK_ID', without('LEDGER_DEPLOY_RESEND_WEBHOOK_ID')],
    ['LEDGER_DEPLOY_RESEND_API_KEY', { ...baseEnv, LEDGER_DEPLOY_RESEND_API_KEY: 'sk_notResend' }],
  ])('refuses naming %s before any step runs, never its value', async (variable, env) => {
    const world = newWorld();

    const run = await deploy(world, { env });

    expect(run.code).toBe(1);
    expect(lastLine(run)).toMatch(new RegExp(`^aws:deploy: refused: ${variable} `));
    expect(run.stepsBuilt).toBe(false);
    expect(world.calls).toEqual([]);
    for (const line of run.lines) {
      expect(line).not.toContain(RESEND_API_KEY);
      expect(line).not.toContain('sk_notResend');
    }
  });

  it('passes the webhook id as context and writes the key after both stack deploys', async () => {
    const world = newWorld();

    const run = await deploy(world);

    expect(run.code).toBe(0);
    expect(world.synthesized?.resendWebhookId).toBe(RESEND_WEBHOOK_ID);
    expect(world.secrets.get(RESEND_API_KEY_SECRET_ARN)).toBe(RESEND_API_KEY);
    expect(run.lines).toContain('aws:deploy: ledger/resend-api-key written\n');
    const writeAt = world.calls.indexOf(`writeSecret:${RESEND_API_KEY_SECRET_ARN}`);
    expect(writeAt).toBeGreaterThan(world.calls.indexOf('deployStack:LedgerApp'));
    for (const line of run.lines) expect(line).not.toContain(RESEND_API_KEY);
  });

  it('writes no key and passes no webhook id when both are unset, with no signing secrets', async () => {
    const world = newWorld();

    const run = await deploy(world, {
      env: without(
        'LEDGER_DEPLOY_RESEND_API_KEY',
        'LEDGER_DEPLOY_RESEND_WEBHOOK_ID',
        'LEDGER_DEPLOY_WEBHOOK_SECRETS',
      ),
    });

    expect(run.code).toBe(0);
    expect(world.synthesized?.resendWebhookId).toBeUndefined();
    expect(world.calls).not.toContain(`writeSecret:${RESEND_API_KEY_SECRET_ARN}`);
    expect(run.lines.join('')).not.toContain('ledger/resend-api-key');
  });
});
