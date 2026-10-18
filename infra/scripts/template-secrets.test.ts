// D33 step 5, CBL-01: the scan finds a secret pattern in any synthesized file a deploy input can
// reach, and ignores the esbuild bundles, which match it by themselves.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findTemplateSecret } from './template-secrets.ts';

let dir: string;

const assembly = (files: Record<string, string>): string => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-template-secrets-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
};

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const bundle = 'var require_validator = 1; new URL(str, "postgres://base");';

describe('findTemplateSecret', () => {
  it('passes a clean assembly whose bundles match the pattern on their own', () => {
    const out = assembly({
      'LedgerApp.template.json': '{"Resources":{}}',
      'manifest.json': '{}',
      'asset.abc123/index.mjs': bundle,
    });
    expect(findTemplateSecret(out)).toBe(false);
  });

  it.each([
    ['a signing secret', 'whsec_ZmFrZQ=='],
    ['a Resend API key', 're_Fake1234'],
    ['a Postgres URL', 'postgresql://owner:pw@db.invalid/ledger'],
    ['a Ledger token', `ldg_${'0'.repeat(20)}`],
  ])('finds %s in a template', (_name, value) => {
    const out = assembly({
      'LedgerApp.template.json': JSON.stringify({ Environment: { X: value } }),
      'asset.abc123/index.mjs': bundle,
    });
    expect(findTemplateSecret(out)).toBe(true);
  });

  it('finds a hit in a nested folder that is not an asset', () => {
    const out = assembly({ 'nested.assembly/LedgerApp.template.json': '"whsec_ZmFrZQ=="' });
    expect(findTemplateSecret(out)).toBe(true);
  });
});
