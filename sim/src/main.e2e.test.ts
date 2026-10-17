import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { maskAddress, maskFrom, maskText, normalizeAddress } from '@ledger/core';
import { ledgerHistory } from '@ledger/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const runTimeoutMs = 30_000;

type Run = { code: number | null; stdout: string; stderr: string };

function runSim(args: readonly string[]): Run {
  const result = spawnSync(process.execPath, [mainPath, ...args], {
    encoding: 'utf8',
    timeout: runTimeoutMs,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The output is two header lines, then the JSON document.
function parts(stdout: string): { line1: string; line2: string; json: string } {
  const [line1 = '', line2 = '', ...rest] = stdout.split('\n');
  return { line1, line2, json: rest.join('\n') };
}

function emailIds(stdout: string): string[] {
  const { emails } = JSON.parse(parts(stdout).json) as { emails: { emailId: string }[] };
  return emails.map(({ emailId }) => emailId);
}

// Every `to`, `from` and `subject` string in the generated payloads, each with the mask the
// projection would print for it.
function generatedPii(seed: number, namespace: string): { value: string; mask: string }[] {
  const [history] = fc.sample(ledgerHistory({ namespace }), { seed, numRuns: 1 });
  const found: { value: string; mask: string }[] = [];
  for (const { events } of history?.emails ?? []) {
    for (const { payload } of events) {
      const data =
        typeof payload === 'object' && payload !== null && 'data' in payload
          ? (payload.data as Record<string, unknown>)
          : {};
      for (const to of [data.to].flat()) {
        if (typeof to === 'string') {
          // A malformed payload joins `to` into one string; it is checked as is.
          found.push({ value: to, mask: maskAddress(normalizeAddress(to)) });
          found.push({ value: normalizeAddress(to), mask: maskAddress(normalizeAddress(to)) });
        }
      }
      if (typeof data.from === 'string') {
        found.push({ value: data.from, mask: maskFrom(data.from) });
      }
      if (typeof data.subject === 'string') {
        found.push({ value: data.subject, mask: maskText(data.subject) });
      }
    }
  }
  return found;
}

describe('pnpm sim (sim/src/main.ts)', () => {
  it('prints byte-identical output for the same seed and namespace, so any run can be replayed', {
    timeout: runTimeoutMs * 2,
  }, () => {
    const first = runSim(['--seed', '42', '--namespace', 'walk']);
    const second = runSim(['--seed', '42', '--namespace', 'walk']);

    expect(first.code).toBe(0);
    expect(first.stderr).toBe('');
    expect(parts(first.stdout).line1).toBe('sim seed=42 namespace=walk');
    expect(parts(first.stdout).line2).toMatch(
      /^history emails=\d+ events=\d+ duplicates=0 shuffled=false$/,
    );
    expect(first.stdout.endsWith('}\n')).toBe(true);
    expect(second.stdout).toBe(first.stdout);
  });

  it('prints the same projection with --shuffle and --duplicates 0.3, so delivery order and redelivery leave state unchanged', {
    timeout: runTimeoutMs * 2,
  }, () => {
    const plain = runSim(['--seed', '42', '--namespace', 'walk']);
    const arranged = runSim([
      '--seed',
      '42',
      '--namespace',
      'walk',
      '--shuffle',
      '--duplicates',
      '0.3',
    ]);

    expect(arranged.code).toBe(0);
    const line2 = parts(arranged.stdout).line2.match(
      /^history emails=(\d+) events=(\d+) duplicates=(\d+) shuffled=true$/,
    );
    expect(line2).not.toBeNull();
    const [, , events = '0', duplicates = '0'] = line2 ?? [];
    expect(Number(duplicates)).toBe(Math.floor(0.3 * Number(events)));
    expect(Number(duplicates)).toBeGreaterThan(0);
    expect(parts(arranged.stdout).json).toBe(parts(plain.stdout).json);
  });

  it('chooses and prints a seed and namespace when none is given, and that pair reproduces the run', {
    timeout: runTimeoutMs * 2,
  }, () => {
    const chosen = runSim([]);
    expect(chosen.code).toBe(0);
    const line1 = parts(chosen.stdout).line1.match(/^sim seed=(\d+) namespace=([a-z0-9-]+)$/);
    expect(line1).not.toBeNull();
    const [, seed = '', namespace = ''] = line1 ?? [];

    expect(runSim(['--seed', seed, '--namespace', namespace]).stdout).toBe(chosen.stdout);
  });

  it('derives every email id from the namespace, so another namespace shares no email id', {
    timeout: runTimeoutMs * 2,
  }, () => {
    const walk = emailIds(runSim(['--seed', '42', '--namespace', 'walk']).stdout);
    const walk2 = emailIds(runSim(['--seed', '42', '--namespace', 'walk2']).stdout);

    expect(walk.length).toBeGreaterThanOrEqual(2);
    expect(walk.every((id) => id.startsWith('walk-'))).toBe(true);
    expect(walk2.every((id) => id.startsWith('walk2-'))).toBe(true);
    expect(walk2.filter((id) => walk.includes(id))).toEqual([]);
  });

  it('prints masks only: no generated address, sender or subject that differs from its mask', {
    timeout: runTimeoutMs,
  }, () => {
    const { stdout, code } = runSim([
      '--seed',
      '42',
      '--namespace',
      'walk',
      '--shuffle',
      '--duplicates',
      '1',
    ]);
    expect(code).toBe(0);
    const pii = generatedPii(42, 'walk').filter(({ value, mask }) => value !== mask);
    // Not vacuous: the history carries addresses, a sender and a subject.
    expect(pii.length).toBeGreaterThan(0);

    for (const { value } of pii) {
      const escaped = JSON.stringify(value);
      // As a whole JSON string value, raw or escaped: a field that printed it instead of its mask.
      expect(stdout).not.toContain(escaped);
      // Inside any value. A subject can be one letter that every JSON key contains, so only
      // addresses and senders (always longer than their `@resend.dev` domain) are checked here.
      if (value.includes('@resend.dev')) {
        expect(stdout).not.toContain(value);
        expect(stdout).not.toContain(escaped.slice(1, -1));
      }
    }
    // A raw local part over a masked domain is a partial leak the whole-value checks above miss.
    // Every `+label` holds the namespace, and a masked local part reveals at most 3 characters.
    expect(pii.some(({ value }) => value.includes('+walk-'))).toBe(true);
    expect(stdout.toLowerCase()).not.toContain('+walk-');
  });

  it.each([
    [['--duplicates', '2'], '--duplicates'],
    [['--duplicates', '-0.1'], '--duplicates'],
    [['--seed', '4294967296'], '--seed'],
    [['--seed', '-1'], '--seed'],
    [['--namespace', 'Walk'], '--namespace'],
    // `--shuffle` matches the namespace format, so only the next-flag check stops it being read
    // as the namespace and the shuffle silently dropped.
    [['--namespace', '--shuffle'], '--namespace'],
    [['--verbose'], '--verbose'],
  ])('rejects %j with one stderr line naming %s, exit 2 and nothing on stdout', (args, flag) => {
    const { code, stdout, stderr } = runSim(args);

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(new RegExp(`^sim: ${flag} [^\\n]+\\n$`));
  });
});
