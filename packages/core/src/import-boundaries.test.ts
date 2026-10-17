// Proves the ADR-013 import boundary with the committed biome.json and the pinned Biome binary,
// over deliberate-violation fixtures written to a temp directory, never into the linted tree.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

// The JS launcher, run by this node binary: node_modules/.bin/biome is a .cmd on Windows, which
// spawnSync refuses without a shell (EINVAL).
const biomeLauncher = join(repoRoot, 'node_modules', '@biomejs', 'biome', 'bin', 'biome');

const copiedConfig = [
  'biome.json',
  'packages/core/package.json',
  'packages/shared/package.json',
  'packages/aws/package.json',
];

const restrictedImportRule = 'lint/style/noRestrictedImports';

type Fixture = { readonly path: string; readonly specifier: string };

const fixtureIn =
  (folder: string) =>
  (specifier: string): Fixture => ({
    path: `${folder}/src/imports-${specifier.replaceAll(/[^a-z0-9]+/gi, '-')}.ts`,
    specifier,
  });

const coreFixture = fixtureIn('packages/core');

// One specifier per pattern in the packages/core override of biome.json, a subpath for each
// `/**` pattern, so narrowing any pattern fails a named case.
const bannedInCore: readonly Fixture[] = [
  // AWS
  '@aws-sdk/client-sqs',
  '@aws-sdk/client-sqs/dist-es/index.js',
  '@aws-lambda-powertools/logger',
  '@aws-crypto/sha256-js',
  '@aws/lambda-invoke-store',
  '@smithy/smithy-client',
  'aws-sdk',
  'aws-sdk/clients/sqs',
  'aws-lambda',
  'aws-cdk-lib/aws-sqs',
  'aws4',
  'aws4fetch',
  'amazon-cognito-identity-js',
  // Postgres
  'pg',
  'pg/lib/client',
  'pg-pool',
  'pg-protocol/dist/messages',
  'postgres',
  'postgres/cjs/src/index.js',
  'postgres-array',
  'drizzle-orm',
  'drizzle-orm/pg-core',
  'drizzle-kit',
  '@neondatabase/serverless',
  '@vercel/postgres',
  '@vercel/postgres/kysely',
  '@electric-sql/pglite',
  '@electric-sql/pglite/vector',
  '@databases/pg',
  '@testcontainers/postgresql',
  '@supabase/supabase-js',
  'prisma',
  '@prisma/client',
  'kysely',
  'knex',
  'slonik',
  'sequelize',
  'typeorm',
  '@mikro-orm/postgresql',
  // Resend
  'resend',
  'resend/build/src/index.js',
  '@resend/webhooks',
  'react-email',
  '@react-email/components',
].map(coreFixture);

// Near misses and what core really imports: the patterns must not catch them.
const allowedInCore: readonly Fixture[] = ['zod', 'fast-check', 'vitest', 'node:crypto'].map(
  coreFixture,
);

// packages/shared shares the packages/core override, so one case per ecosystem pins that.
const bannedInShared: readonly Fixture[] = ['@aws-sdk/client-sqs', 'postgres', 'resend'].map(
  fixtureIn('packages/shared'),
);

const awsImportsAwsSdk: Fixture = {
  path: 'packages/aws/src/imports-aws-sdk-client-sqs.ts',
  specifier: '@aws-sdk/client-sqs',
};

const awsDeepImport: Fixture = {
  path: 'packages/aws/src/imports-ledger-db-deep.ts',
  specifier: '@ledger/db/src/x.ts',
};

const fixtures: readonly Fixture[] = [
  ...bannedInCore,
  ...allowedInCore,
  ...bannedInShared,
  awsImportsAwsSdk,
  awsDeepImport,
];

type Diagnostic = { readonly category?: string; readonly location?: { readonly path?: string } };

let workDir = '';
let diagnostics: readonly Diagnostic[] = [];

const restrictedImportCount = (fixture: Fixture): number =>
  diagnostics.filter(
    (diagnostic) =>
      diagnostic.category === restrictedImportRule &&
      // Biome reports Windows paths with backslashes.
      diagnostic.location?.path?.replaceAll('\\', '/') === fixture.path,
  ).length;

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'ledger-import-boundaries-'));

  for (const file of copiedConfig) {
    mkdirSync(dirname(join(workDir, file)), { recursive: true });
    copyFileSync(join(repoRoot, file), join(workDir, file));
  }
  for (const fixture of fixtures) {
    mkdirSync(dirname(join(workDir, fixture.path)), { recursive: true });
    writeFileSync(
      join(workDir, fixture.path),
      `import * as imported from '${fixture.specifier}';\n\nexport const value = imported;\n`,
    );
  }

  const run = spawnSync(
    process.execPath,
    [biomeLauncher, 'lint', '--vcs-enabled=false', '--reporter=json', '--max-diagnostics=none'],
    { cwd: workDir, encoding: 'utf8' },
  );
  if (run.error) throw run.error;

  // Biome exits 1 on the deliberate violations; the JSON report on stdout is what is asserted.
  const report = JSON.parse(run.stdout) as { diagnostics?: readonly Diagnostic[] };
  diagnostics = report.diagnostics ?? [];
}, 60_000);

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('packages/core import boundary (ADR-013)', () => {
  it.each(bannedInCore)(
    'importing $specifier in packages/core raises noRestrictedImports, so the lint stage fails',
    (fixture) => {
      expect(restrictedImportCount(fixture)).toBe(1);
    },
  );

  it.each(allowedInCore)(
    'importing $specifier in packages/core raises no restricted-import error, so pure code still lints',
    (fixture) => {
      expect(restrictedImportCount(fixture)).toBe(0);
    },
  );
});

describe('packages/shared import boundary (ADR-013)', () => {
  it.each(bannedInShared)(
    'importing $specifier in packages/shared raises noRestrictedImports, so the lint stage fails',
    (fixture) => {
      expect(restrictedImportCount(fixture)).toBe(1);
    },
  );
});

describe('biome.json override scoping', () => {
  it('importing @aws-sdk/client-sqs in packages/aws raises nothing, because its override replaces the base list', () => {
    expect(restrictedImportCount(awsImportsAwsSdk)).toBe(0);
  });

  it('a deep @ledger/db import in packages/aws still raises noRestrictedImports, because the override restates that pattern', () => {
    expect(restrictedImportCount(awsDeepImport)).toBe(1);
  });
});
