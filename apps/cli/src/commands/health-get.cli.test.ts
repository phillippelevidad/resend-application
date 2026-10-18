import { apiUnavailable, type Health, type SdkError } from '@ledger/sdk';
import { FakeLedgerClient } from '@ledger/sdk/testing';
import { describe, expect, it } from 'vitest';
import { runCli } from '../testing/run-cli.ts';
import { unauthorized, unknownCode } from '../testing/sdk-errors.ts';
import { formatBytes } from './health-get.cli.ts';

// `ledger health` against the fake SDK: exit codes and the bytes on stdout and stderr (pp-cli →
// cli-tests; design.md → Surfaces, `health.get`).

const healthy: Health = {
  object: 'health',
  queue: { visible: 0, in_flight: 0, oldest_age_seconds: null },
  dlq: { visible: 0, in_flight: 0 },
  event_source: { state: 'enabled' },
  database: { reachable: true, storage_bytes: 9437184, storage_limit_bytes: 1000000000 },
};

const answering = (data: Health) => new FakeLedgerClient({ healthGet: { data, error: null } });
const failing = (error: SdkError) => new FakeLedgerClient({ healthGet: { data: null, error } });

describe('ledger health', () => {
  it('--json prints exactly data as one document and exits 0', async () => {
    const client = answering(healthy);

    const result = await runCli(['health', '--json'], client);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(healthy);
    expect(result.stderr).toBe('');
    expect(client.calls).toEqual([{ method: 'health.get' }]);
  });

  it('prints the healthy layout, uncoloured, and exits 0', async () => {
    const result = await runCli(['health'], answering(healthy));

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\u001b[');
    expect(result.stdout).toBe(
      [
        'queue       0 visible, 0 in flight, oldest —',
        'dlq         0 visible, 0 in flight',
        'worker      enabled',
        'database    reachable, 9.4 MB of 1.0 GB',
        '',
      ].join('\n'),
    );
  });

  it('prints oldest <n>s, a paused worker and an unreachable database during an outage', async () => {
    const outage: Health = {
      ...healthy,
      queue: { visible: 12, in_flight: 3, oldest_age_seconds: 840 },
      dlq: { visible: 1, in_flight: 0 },
      event_source: { state: 'paused' },
      database: { reachable: false, storage_bytes: null, storage_limit_bytes: 1000000000 },
    };

    const result = await runCli(['health'], answering(outage));

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      [
        'queue       12 visible, 3 in flight, oldest 840s',
        'dlq         1 visible, 0 in flight',
        'worker      paused',
        'database    unreachable',
        '',
      ].join('\n'),
    );
  });

  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1.0 kB'],
    [9437184, '9.4 MB'],
    [999_960_000, '1.0 GB'],
    [1000000000, '1.0 GB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });

  it('--json on a registry error prints exactly { error } on stdout and exits 1', async () => {
    const result = await runCli(['health', '--json'], failing(unauthorized));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: unauthorized });
    expect(result.stderr).toBe('');
  });

  it('a registry error without --json prints message and hint on stderr only, exit 1', async () => {
    const result = await runCli(['health'], failing(unauthorized));

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${unauthorized.message}\nhint: ${unauthorized.hint}\n`);
  });

  it.each([
    ['an unknown code', unknownCode],
    ['api_unavailable (a tripped stack)', apiUnavailable],
  ])('prints %s as received and exits 1', async (_case, error) => {
    const result = await runCli(['health', '--json'], failing(error));

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error });
  });

  it.each([
    [['health', 'extra'], 'too many arguments'],
    [['health', '--bogus'], "unknown option '--bogus'"],
  ])('a usage error (%j) exits 2 with no call and stdout empty', async (args, message) => {
    const client = answering(healthy);

    const result = await runCli(args, client);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(client.calls).toEqual([]);
  });

  it('a missing LEDGER_URL exits 2 naming it, with no call', async () => {
    const client = answering(healthy);

    const result = await runCli(['health'], client, { LEDGER_TOKEN: 'secret-token-value' });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('LEDGER_URL');
    expect(result.stderr).not.toContain('secret-token-value');
    expect(client.calls).toEqual([]);
  });
});
