import { parseArgs } from 'node:util';

// D16: the flags of `pnpm sim`. A missing seed or namespace stays undefined: `main.ts` picks it.
export type SimFlags = {
  seed: number | undefined;
  namespace: string | undefined;
  // The share of the history's events to repeat, 0 to 1.
  duplicates: number;
  shuffle: boolean;
};

const options = {
  seed: { type: 'string' },
  namespace: { type: 'string' },
  duplicates: { type: 'string' },
  shuffle: { type: 'boolean' },
} as const;

export const maxSeed = 2 ** 32 - 1;

const notAFlag = 'is not a flag; the flags are --seed, --namespace, --duplicates and --shuffle';

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
  return {
    seed: readSeed(stringValue(values.seed)),
    namespace: readNamespace(stringValue(values.namespace)),
    duplicates: readDuplicates(stringValue(values.duplicates)),
    shuffle: values.shuffle === true,
  };
}
