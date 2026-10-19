// D32, R20's bundles: every synthesized function bundle loads in Node 24 and exports a `handler`
// function, with no AWS access. Both stacks are synthesized for real (local esbuild, ES modules);
// each `index.mjs` is imported in its own Node process with its internal variables set to dummy
// values and no AWS credentials or config reachable, so a composition root that calls AWS at import,
// or a bundle that throws on load (a CommonJS `require()` inside the ES-module output, an unresolved
// optional dependency), fails here before any deploy. A failure is fixed by D32's remedy only then:
// esbuild's `createRequire` banner, or `pg-native` marked external.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { App } from 'aws-cdk-lib';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { AppStack } from './app.stack.ts';
import { GuardrailsStack } from './guardrails.stack.ts';

const outdir = mkdtempSync(join(tmpdir(), 'ledger-bundle-smoke-'));
const app = new App({ outdir, context: { 'aws:cdk:enable-asset-metadata': true } });
new GuardrailsStack(app, 'LedgerGuardrails', {
  appStackName: 'LedgerApp',
  budgetUsd: 50,
  killSwitch: true,
  budgetDrill: false,
});
new AppStack(app, 'LedgerApp', {
  commit: '0123456789abcdef0123456789abcdef01234567',
  guardrailsStackName: 'LedgerGuardrails',
  // The owner's shape, so ingest also loads with its optional `SIMULATOR_SECRET_ARN` (slice 3, D12).
  simulator: true,
});
const assembly = app.synth();

type FunctionResource = {
  Type: string;
  Metadata?: Record<string, unknown>;
  Properties: { FunctionName: string; Environment?: { Variables: Record<string, unknown> } };
};

const bundles = assembly.stacks.flatMap((stack) =>
  Object.values(stack.template.Resources as Record<string, FunctionResource>)
    .filter((resource) => resource.Type === 'AWS::Lambda::Function')
    .map((fn) => ({
      functionName: fn.Properties.FunctionName,
      entry: join(assembly.directory, String(fn.Metadata?.['aws:asset:path']), 'index.mjs'),
      variables: Object.keys(fn.Properties.Environment?.Variables ?? {}),
    })),
);

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(outdir, { recursive: true, force: true });
});

// Imports the bundle, checks `handler`, and exits at once, so an open handle cannot hang the run.
const loader = [
  'const bundle = await import(process.argv[1]);',
  "if (typeof bundle.handler !== 'function') {",
  "  console.error('handler is ' + typeof bundle.handler);",
  '  process.exit(3);',
  '}',
  'process.exit(0);',
].join('\n');

describe('function bundles', () => {
  it('synthesizes the four functions of both stacks', () => {
    expect(bundles.map((bundle) => bundle.functionName).sort()).toEqual(
      [
        'LedgerApp-api',
        'LedgerApp-ingest',
        'LedgerApp-worker',
        'LedgerGuardrails-kill-switch',
      ].sort(),
    );
  });

  it.each(bundles)('$functionName loads in Node and exports a handler function', (bundle) => {
    expect(existsSync(bundle.entry)).toBe(true);
    // What the Lambda runtime sets (AWS-56), then each internal variable as a dummy of its form.
    vi.stubEnv('AWS_REGION', 'us-east-2');
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', bundle.functionName);
    for (const name of bundle.variables) {
      vi.stubEnv(name, name.endsWith('_URL') ? 'https://queue.invalid/dummy' : 'dummy');
    }
    // No credentials and no config to find, so an AWS call at import cannot succeed.
    const nowhere = join(outdir, 'no-aws');
    vi.stubEnv('AWS_SHARED_CREDENTIALS_FILE', join(nowhere, 'credentials'));
    vi.stubEnv('AWS_CONFIG_FILE', join(nowhere, 'config'));
    vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
      'AWS_PROFILE',
    ]) {
      vi.stubEnv(name, undefined);
    }

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', loader, pathToFileURL(bundle.entry).href],
      { encoding: 'utf8', timeout: 30_000 },
    );

    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: '' });
  });
});
