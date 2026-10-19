import { describe, expect, it } from 'vitest';
import { readSimFlags } from './read-sim-flags.ts';

// `readSimFlags` throws `<flag> <reason>`, which `main.ts` prints as `sim: <flag> <reason>` and
// exits 2 on; `main.e2e.test.ts` proves that half.
function rejection(args: readonly string[]): string {
  try {
    readSimFlags(args);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected ${JSON.stringify(args)} to be rejected`);
}

describe('readSimFlags', () => {
  it('reads no flags as a plain run: no seed or namespace, no knob', () => {
    expect(readSimFlags([])).toEqual({
      seed: undefined,
      namespace: undefined,
      duplicates: 0,
      shuffle: false,
      burst: undefined,
      chaos: undefined,
      poison: undefined,
    });
  });

  it('reads the slice 0 and 1 flags as before', () => {
    expect(
      readSimFlags(['--seed', '42', '--namespace', 'walk', '--duplicates', '0.2', '--shuffle']),
    ).toMatchObject({ seed: 42, namespace: 'walk', duplicates: 0.2, shuffle: true });
  });

  it.each([
    [['--duplicates', '2'], '--duplicates'],
    [['--seed', '-1'], '--seed'],
    [['--namespace', 'Walk'], '--namespace'],
    [['--namespace', '--shuffle'], '--namespace'],
    [['--verbose'], '--verbose'],
    [['--', '--shuffle'], '--'],
  ])('still rejects %j naming %s', (args, flag) => {
    expect(rejection(args).startsWith(`${flag} `)).toBe(true);
  });

  describe('--burst <events>/<seconds>s (D25)', () => {
    it.each([
      ['10000/10s', { events: 10_000, seconds: 10 }],
      ['1/1s', { events: 1, seconds: 1 }],
      ['20/600s', { events: 20, seconds: 600 }],
      ['0100/010s', { events: 100, seconds: 10 }],
    ])('reads %s', (value, burst) => {
      expect(readSimFlags(['--burst', value]).burst).toEqual(burst);
    });

    it('reads --burst=<value> like --burst <value>', () => {
      expect(readSimFlags(['--burst=10000/10s']).burst).toEqual({ events: 10_000, seconds: 10 });
    });

    it.each([
      '20000/10s',
      '10001/10s',
      '0/10s',
      '100/0s',
      '100/601s',
      '100/10',
      '100s',
      '/10s',
      '100/10m',
      '1e3/10s',
      '-1/10s',
      '100/1.5s',
      ' 100/10s',
      '',
    ])('rejects %j naming --burst and its range', (value) => {
      expect(rejection(['--burst', value])).toBe(
        '--burst must be <events>/<seconds>s with 1 to 10000 events over 1 to 600 seconds',
      );
    });

    it('rejects --burst with no value', () => {
      expect(rejection(['--burst'])).toBe('--burst needs a value');
    });

    it('rejects --burst followed by another flag instead of reading it as the value', () => {
      expect(rejection(['--burst', '--shuffle'])).toBe(
        '--burst needs a value; --shuffle is the next flag',
      );
    });
  });

  describe('--chaos (D27)', () => {
    it('reads db-outage', () => {
      expect(readSimFlags(['--chaos', 'db-outage']).chaos).toBe('db-outage');
    });

    it.each(['network', 'DB-OUTAGE', 'db-outage ', 'worker-crash:0.05', ''])(
      'rejects %j: db-outage is the only fault',
      (value) => {
        expect(rejection(['--chaos', value])).toBe('--chaos must be db-outage');
      },
    );
  });

  describe('--poison <1-10> (D27)', () => {
    it.each([
      ['1', 1],
      ['10', 10],
      ['05', 5],
    ])('reads %s', (value, poison) => {
      expect(readSimFlags(['--poison', value]).poison).toBe(poison);
    });

    it.each(['0', '11', '100', '-1', '1.5', 'one', '', '010'])(
      'rejects %j: the poisoned set must fit one inspect sample',
      (value) => {
        expect(rejection(['--poison', value])).toBe('--poison must be an integer from 1 to 10');
      },
    );
  });

  describe('exclusivity (D23)', () => {
    it.each([
      [['--burst', '100/10s', '--chaos', 'db-outage'], '--burst and --chaos'],
      [['--burst', '100/10s', '--poison', '1'], '--burst and --poison'],
      [['--burst', '100/10s', '--duplicates', '0.2'], '--burst and --duplicates'],
      [['--chaos', 'db-outage', '--poison', '1'], '--chaos and --poison'],
      [['--chaos', 'db-outage', '--duplicates', '0.2'], '--chaos and --duplicates'],
      [['--poison', '1', '--duplicates', '0.2'], '--poison and --duplicates'],
      // The pair is named in a fixed order, whatever order the flags came in.
      [['--duplicates', '0.2', '--poison', '1'], '--poison and --duplicates'],
      // A zero ratio is still the flag given.
      [['--duplicates', '0', '--burst', '100/10s'], '--burst and --duplicates'],
    ])('rejects %j naming %s', (args, pair) => {
      expect(rejection(args)).toBe(`${pair} exclude each other; pass one of them`);
    });

    it('names the first two knobs when three are given', () => {
      expect(rejection(['--poison', '1', '--chaos', 'db-outage', '--burst', '1/1s'])).toBe(
        '--burst and --chaos exclude each other; pass one of them',
      );
    });

    it.each([
      [['--burst', '100/10s', '--shuffle'], { burst: { events: 100, seconds: 10 } }],
      [['--chaos', 'db-outage', '--shuffle'], { chaos: 'db-outage' }],
      [['--poison', '3', '--shuffle'], { poison: 3 }],
      [['--duplicates', '0.2', '--shuffle'], { duplicates: 0.2 }],
    ])('combines %j with --shuffle', (args, knob) => {
      expect(readSimFlags(args)).toMatchObject({ ...knob, shuffle: true });
    });

    it('combines a knob with --seed and --namespace', () => {
      expect(
        readSimFlags(['--seed', '7', '--namespace', 'burst', '--burst', '10000/10s']),
      ).toMatchObject({ seed: 7, namespace: 'burst', burst: { events: 10_000, seconds: 10 } });
    });
  });
});
