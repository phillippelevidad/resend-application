import { parseArgs } from 'node:util';

// D16: the flags of `pnpm sim`. A missing seed or namespace stays undefined: `main.ts` picks it.
// D23: `--burst`, `--chaos` and `--poison` are the AWS runs' knobs, each undefined when not given.
export type SimFlags = {
  seed: number | undefined;
  namespace: string | undefined;
  // The share of the history's events to repeat, 0 to 1.
  duplicates: number;
  shuffle: boolean;
  // D25: `<events>/<seconds>s`, the events sent paced over the seconds.
  burst: BurstFlag | undefined;
  // D27: the one chaos fault this slice has.
  chaos: ChaosFault | undefined;
  // D27: how many events to poison, 1 to 10, so the poisoned set fits one DLQ inspect sample.
  poison: number | undefined;
};

export type BurstFlag = { events: number; seconds: number };

export type ChaosFault = 'db-outage';

const options = {
  seed: { type: 'string' },
  namespace: { type: 'string' },
  duplicates: { type: 'string' },
  shuffle: { type: 'boolean' },
  burst: { type: 'string' },
  chaos: { type: 'string' },
  poison: { type: 'string' },
} as const;

export const maxSeed = 2 ** 32 - 1;

// D25: the burst's ceiling (about.md → Platform scale assumptions) and its longest pacing.
export const maxBurstEvents = 10_000;
export const maxBurstSeconds = 600;
export const maxPoison = 10;

// D23: the knobs that exclude one another, in the order a combination names them. `--shuffle`
// combines with any.
const exclusiveKnobs = ['burst', 'chaos', 'poison', 'duplicates'] as const;

const notAFlag =
  'is not a flag; the flags are --seed, --namespace, --duplicates, --shuffle, --burst, --chaos and --poison';

// `sim` is not a surface: a bad flag throws `Error` with `<flag> <reason>`, which `main.ts` prints
// as `sim: <flag> <reason>` and exits 2 (pp-general → errors).
function reject(flag: string, reason: string): never {
  throw new Error(`${flag} ${reason}`);
}

function isFlagName(name: string): name is keyof typeof options {
  return Object.hasOwn(options, name);
}

// Non-strict parsing with tokens, so each bad argument is named on its own line instead of in
// `parseArgs`'s own wording.
function checkTokens(args: readonly string[]): void {
  const { tokens } = parseArgs({
    args: [...args],
    options,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  for (const token of tokens) {
    if (token.kind === 'option-terminator') {
      // pnpm 10.11 forwards a literal `--`, which would turn every flag after it into a positional.
      reject('--', 'is not accepted; pass the flags without it');
    }
    if (token.kind === 'positional') {
      reject(token.value, notAFlag);
    }
    if (!isFlagName(token.name)) {
      reject(token.rawName, notAFlag);
    }
    const { type } = options[token.name];
    if (type === 'string' && token.value === undefined) {
      reject(token.rawName, 'needs a value');
    }
    // Non-strict parsing takes the next argument as the value even when it is another flag, so
    // `--namespace --shuffle` would read `--shuffle` as the namespace (it matches the format) and
    // silently drop the shuffle. A dash-led value like `--seed -1` still reaches the value checks.
    if (type === 'string' && token.inlineValue === false && token.value?.startsWith('--')) {
      reject(token.rawName, `needs a value; ${token.value} is the next flag`);
    }
    if (type === 'boolean' && token.value !== undefined) {
      reject(token.rawName, 'takes no value');
    }
  }
}

function readSeed(value: string | undefined): number | undefined {
  if (value !== undefined && (!/^\d{1,10}$/.test(value) || Number(value) > maxSeed)) {
    reject('--seed', `must be an integer from 0 to ${maxSeed}`);
  }
  return value === undefined ? undefined : Number(value);
}

function readNamespace(value: string | undefined): string | undefined {
  if (value !== undefined && !/^[a-z0-9-]{1,32}$/.test(value)) {
    reject('--namespace', 'must be 1 to 32 characters from a-z, 0-9 and -');
  }
  return value;
}

function readDuplicates(value: string | undefined): number {
  if (value !== undefined && (!/^(\d+(\.\d+)?|\.\d+)$/.test(value) || Number(value) > 1)) {
    reject('--duplicates', 'must be a ratio from 0 to 1');
  }
  return value === undefined ? 0 : Number(value);
}

function readBurst(value: string | undefined): BurstFlag | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d+)\/(\d+)s$/.exec(value);
  const events = Number(match?.[1]);
  const seconds = Number(match?.[2]);
  if (
    match === null ||
    events < 1 ||
    events > maxBurstEvents ||
    seconds < 1 ||
    seconds > maxBurstSeconds
  ) {
    reject(
      '--burst',
      `must be <events>/<seconds>s with 1 to ${maxBurstEvents} events over 1 to ${maxBurstSeconds} seconds`,
    );
  }
  return { events, seconds };
}

function readChaos(value: string | undefined): ChaosFault | undefined {
  if (value !== undefined && value !== 'db-outage') {
    reject('--chaos', 'must be db-outage');
  }
  return value;
}

function readPoison(value: string | undefined): number | undefined {
  if (
    value !== undefined &&
    (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > maxPoison)
  ) {
    reject('--poison', `must be an integer from 1 to ${maxPoison}`);
  }
  return value === undefined ? undefined : Number(value);
}

// D23: two knobs in one run is a flag error naming the pair, the first two given in
// `exclusiveKnobs` order.
function checkExclusive(values: Readonly<Record<string, unknown>>): void {
  const given = exclusiveKnobs.filter((knob) => values[knob] !== undefined);
  const [first, second] = given;
  if (first !== undefined && second !== undefined) {
    reject(`--${first}`, `and --${second} exclude each other; pass one of them`);
  }
}

// `checkTokens` has already enforced what strict mode would, so a string option holds a string here.
function stringValue(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// Every flag is checked before a missing seed or namespace is chosen, and before anything is printed
// (D16). The values are read non-strict too: strict mode throws its own multi-line message for a
// value that starts with `-` (`--seed -1`), where the value checks below name the flag in one line.
export function readSimFlags(args: readonly string[]): SimFlags {
  checkTokens(args);
  const { values } = parseArgs({ args: [...args], options, strict: false, allowPositionals: true });
  const flags: SimFlags = {
    seed: readSeed(stringValue(values.seed)),
    namespace: readNamespace(stringValue(values.namespace)),
    duplicates: readDuplicates(stringValue(values.duplicates)),
    shuffle: values.shuffle === true,
    burst: readBurst(stringValue(values.burst)),
    chaos: readChaos(stringValue(values.chaos)),
    poison: readPoison(stringValue(values.poison)),
  };
  checkExclusive(values);
  return flags;
}
