import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maskAddress, maskFrom, maskText, normalizeAddress } from '@ledger/core';
import { ledgerHistory, testAddressSequences } from '@ledger/core/testing';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const mainPath = fileURLToPath(new URL('./main.ts', import.meta.url));
const runTimeoutMs = 30_000;

type Run = { code: number | null; stdout: string; stderr: string };

// D37: every live-mode variable removed, so a developer's shell (or an exported `.env.local`) cannot
// flip a run live; a test that wants one sets it in `env`.
const liveNames = [
  'LEDGER_URL',
  'LEDGER_SIMULATOR_SECRET',
  'DATABASE_URL',
  'LEDGER_ADDRESS_HASH_KEY',
] as const;

function baseEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of liveNames) {
    delete env[name];
  }
  return env;
}

function runSim(
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; nodeFlags?: readonly string[] } = {},
): Run {
  const result = spawnSync(process.execPath, [...(options.nodeFlags ?? []), mainPath, ...args], {
    encoding: 'utf8',
    timeout: runTimeoutMs,
    env: { ...baseEnv(), ...options.env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A loopback port nothing listens on: bound by the OS, then released.
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}

// Throwaway values for the live prerequisites: none is a real secret, and nothing connects to the
// database before the first request is answered.
const livePrerequisites = {
  LEDGER_SIMULATOR_SECRET: `whsec_${Buffer.from('simulator-test-secret').toString('base64')}`,
  DATABASE_URL: 'postgres://ledger:ledger@127.0.0.1:1/ledger',
  LEDGER_ADDRESS_HASH_KEY: '0a'.repeat(32),
};

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
  const [history] = fc.sample(ledgerHistory({ namespace, labelEveryAddress: true }), {
    seed,
    numRuns: 1,
  });
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
    // Every `+label` holds the namespace (`+walk-<n>`, or `+walk` on the probe's two), and a masked
    // local part reveals at most 3 characters.
    expect(pii.some(({ value }) => value.includes('+walk-'))).toBe(true);
    expect(pii.some(({ value }) => value.includes('+walk@'))).toBe(true);
    expect(stdout.toLowerCase()).not.toContain('+walk');
  });

  it('labels every address with the run namespace and adds the walk probe, so two runs never share a recipient', {
    timeout: runTimeoutMs,
  }, () => {
    const { stdout, code } = runSim(['--seed', '42', '--namespace', 'walk']);
    expect(code).toBe(0);

    // D38: the history `pnpm sim` folds is the labelled one, every address `+walk-<n>` or the
    // probe's `+walk`.
    const [history] = fc.sample(ledgerHistory({ namespace: 'walk', labelEveryAddress: true }), {
      seed: 42,
      numRuns: 1,
    });
    const addresses = (history?.emails ?? []).flatMap(({ events }) =>
      events.flatMap(({ payload }) => {
        const data =
          typeof payload === 'object' && payload !== null && 'data' in payload
            ? (payload.data as { to?: unknown })
            : {};
        return [data.to].flat().filter((to): to is string => typeof to === 'string');
      }),
    );
    expect(addresses.length).toBeGreaterThan(0);
    // Normalized, because the generator also draws case and whitespace spellings of each address.
    for (const address of addresses) {
      expect(normalizeAddress(address)).toMatch(/\+walk(-\d+)?@resend\.dev$/);
    }

    // The printed document is that history's: the probe and, D39, one email per observed
    // test-address sequence are in it, and every printed mask is the mask of a labelled address.
    expect(emailIds(stdout)).toEqual(
      expect.arrayContaining([
        'walk-probe',
        ...Object.keys(testAddressSequences).map((local) => `walk-observed-${local}`),
      ]),
    );
    const masks = new Set(addresses.map((address) => maskAddress(normalizeAddress(address))));
    const printed = JSON.parse(parts(stdout).json) as {
      emails: { recipients: { addressMasked: string }[] }[];
    };
    const printedMasks = printed.emails.flatMap(({ recipients }) =>
      recipients.map(({ addressMasked }) => addressMasked),
    );
    expect(printedMasks.length).toBeGreaterThan(0);
    for (const mask of printedMasks) {
      expect(masks.has(mask)).toBe(true);
    }
  });

  it('stays offline when the shell sets LEDGER_URL empty, even with .env.local holding one', {
    timeout: runTimeoutMs * 2,
  }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-sim-'));
    try {
      const envFile = join(dir, '.env.local');
      // Nothing listens on port 1, so a live run could not exit 0.
      writeFileSync(envFile, 'LEDGER_URL=http://127.0.0.1:1\n');
      const offline = runSim(['--seed', '42', '--namespace', 'walk']);
      // The root script's own flag, so the precedence proven is the one `pnpm sim` gets.
      const shellEmpty = runSim(['--seed', '42', '--namespace', 'walk'], {
        env: { LEDGER_URL: '' },
        nodeFlags: [`--env-file-if-exists=${envFile}`],
      });

      expect(shellEmpty.code).toBe(0);
      expect(shellEmpty.stderr).toBe('');
      expect(shellEmpty.stdout).toBe(offline.stdout);
      expect(shellEmpty.stdout).not.toContain('sent requests=');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(Object.keys(livePrerequisites))(
    'refuses a live run without %s: one stderr line naming it, exit 2 and nothing on stdout',
    (name) => {
      const { code, stdout, stderr } = runSim(['--seed', '42', '--namespace', 'walk'], {
        env: { ...livePrerequisites, LEDGER_URL: 'http://127.0.0.1:1', [name]: '' },
      });

      expect(code).toBe(2);
      expect(stdout).toBe('');
      expect(stderr).toBe(`sim: ${name} is required when LEDGER_URL is set\n`);
    },
  );

  it('stops after the first request when nothing listens at LEDGER_URL, exit 1, never printing the URL', {
    timeout: runTimeoutMs,
  }, async () => {
    const port = await closedPort();
    const ledgerUrl = `http://127.0.0.1:${port}`;
    const { code, stdout, stderr } = runSim(['--seed', '42', '--namespace', 'walk'], {
      env: { ...livePrerequisites, LEDGER_URL: ledgerUrl },
    });

    expect(code).toBe(1);
    expect(stderr).toBe(
      'sim: no Ledger answered at LEDGER_URL; start it with pnpm dev:full, or run LEDGER_URL= pnpm sim for an offline run\n',
    );
    // The header and projection print first; no send summary follows a run that sent nothing.
    expect(parts(stdout).line1).toBe('sim seed=42 namespace=walk');
    expect(stdout).not.toContain('sent requests=');
    expect(`${stdout}${stderr}`).not.toContain(String(port));
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
    [['--burst', '20000/10s'], '--burst'],
    [['--burst', '10/0s'], '--burst'],
    [['--chaos', 'network'], '--chaos'],
    [['--poison', '11'], '--poison'],
  ])('rejects %j with one stderr line naming %s, exit 2 and nothing on stdout', (args, flag) => {
    const { code, stdout, stderr } = runSim(args);

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toMatch(new RegExp(`^sim: ${flag} [^\\n]+\\n$`));
  });

  it('names every flag, the AWS knobs included, when given one it does not know', () => {
    const { code, stderr } = runSim(['--help']);

    expect(code).toBe(2);
    expect(stderr).toBe(
      'sim: --help is not a flag; the flags are --seed, --namespace, --duplicates, --shuffle, --burst, --chaos and --poison\n',
    );
  });

  it.each([
    [['--burst', '10/1s', '--poison', '1'], '--burst and --poison'],
    [['--chaos', 'db-outage', '--burst', '10/1s'], '--burst and --chaos'],
    [['--poison', '1', '--duplicates', '0.2'], '--poison and --duplicates'],
    [['--chaos', 'db-outage', '--duplicates', '0.2', '--shuffle'], '--chaos and --duplicates'],
  ])('refuses the knob pair %j naming %s, exit 2 and nothing on stdout', (args, pair) => {
    const { code, stdout, stderr } = runSim(args, { env: { LEDGER_URL: '' } });

    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe(`sim: ${pair} exclude each other; pass one of them\n`);
  });

  it.each([
    [['--burst', '10000/10s'], '--burst'],
    [['--chaos', 'db-outage'], '--chaos'],
    [['--poison', '1', '--shuffle'], '--poison'],
  ])(
    'refuses the AWS run %j without LEDGER_URL: its one line, exit 2, nothing on stdout and no AWS call',
    {
      timeout: runTimeoutMs,
    },
    async (args, knob) => {
      // Every AWS client is pointed at a loopback listener that counts connections, with throwaway
      // credentials, so an AWS call the run made never leaves the machine. `spawnSync` blocks this
      // process, so such a call goes unanswered and the run times out (`code` null) as well as
      // being counted.
      let connections = 0;
      const aws = createServer((_request, response) => response.end());
      aws.on('connection', () => {
        connections += 1;
      });
      await new Promise<void>((resolve) => aws.listen(0, '127.0.0.1', resolve));
      const { port } = aws.address() as AddressInfo;
      try {
        // The deployed file's other names loaded, `LEDGER_URL` emptied by the shell.
        const { code, stdout, stderr } = runSim(args, {
          env: {
            ...livePrerequisites,
            LEDGER_URL: '',
            AWS_ENDPOINT_URL: `http://127.0.0.1:${port}`,
            AWS_REGION: 'us-east-2',
            AWS_ACCESS_KEY_ID: 'sim-e2e-not-a-key',
            AWS_SECRET_ACCESS_KEY: 'sim-e2e-not-a-secret',
          },
        });
        // `spawnSync` blocked this process's loop; one turn lets any queued connection be counted.
        await new Promise((resolve) => setImmediate(resolve));

        expect(code).toBe(2);
        expect(stdout).toBe('');
        expect(stderr).toBe(
          `sim: ${knob} needs a live run against the deployed stack: load .env.deployed.local\n`,
        );
        expect(connections).toBe(0);
      } finally {
        await new Promise<void>((resolve) => aws.close(() => resolve()));
      }
    },
  );
});
