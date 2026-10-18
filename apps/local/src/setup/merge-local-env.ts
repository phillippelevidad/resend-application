import { hashApiToken, hasValidTag } from '@ledger/shared';

// D41: the names `pnpm db:setup` owns in `.env.local`, in the order it writes them. `LEDGER_TOKEN`
// is last because it is minted only after the database is prepared.
export const localEnvNames = [
  'DATABASE_URL',
  'LEDGER_ADDRESS_HASH_KEY',
  'LEDGER_TOKEN_TAG_KEY',
  'LEDGER_SIMULATOR_SECRET',
  'LEDGER_URL',
  'LEDGER_TOKEN',
] as const;

export type LocalEnvName = (typeof localEnvNames)[number];

export type SetOnceEnvName = Exclude<LocalEnvName, 'LEDGER_TOKEN'>;

// D41: every name but `LEDGER_TOKEN`, written before the database is touched and never overwritten.
export const setOnceEnvNames = localEnvNames.filter(
  (name): name is SetOnceEnvName => name !== 'LEDGER_TOKEN',
);

// Slice 1's value, which the loopback server accepted while it skipped auth; a working token never
// equals it (D41).
export const LOOPBACK_PLACEHOLDER_TOKEN = 'local-loopback-no-auth';

export type MergedLocalEnv<N extends LocalEnvName = LocalEnvName> = {
  // The new file text.
  text: string;
  // The names written, in the order given, so the caller prints one line per name and never a
  // value.
  written: N[];
};

export type MergeLocalEnvOptions = {
  // D41's one replacement rule: write `LEDGER_TOKEN` even when it is set, because the caller found
  // it not working (`isWorkingLocalToken`). Every other name is never overwritten.
  replaceToken?: boolean;
};

// `NAME=value` or `export NAME=value`, the value up to the line terminator.
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*?)\r?\n?$/;

// Empty as `node --env-file` reads it: nothing, a pair of empty quotes, or only a comment.
function isEmptyValue(raw: string): boolean {
  const value = raw.trim();
  return value === '' || value === '""' || value === "''" || value.startsWith('#');
}

// D31, D41: for each of `names`, in the order given, write `NAME=<generate(NAME)>` only when the
// name is absent or its value is empty, or, for `LEDGER_TOKEN` alone, when `replaceToken` is set. A
// set value is otherwise never overwritten, and every other line, comment and line terminator is
// kept as it was. An existing assignment is rewritten in place; an absent name is appended. When a
// name is assigned twice, the last assignment is the one `node --env-file` uses, so it is the one
// read and rewritten. Pure: the caller reads and writes the file.
export function mergeLocalEnv<N extends LocalEnvName>(
  text: string,
  names: readonly N[],
  generate: (name: N) => string,
  { replaceToken = false }: MergeLocalEnvOptions = {},
): MergedLocalEnv<N> {
  // Each line keeps its own terminator, so joining them back reproduces the text exactly.
  const lines = text === '' ? [] : text.split(/(?<=\n)/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const written: N[] = [];
  const appended: string[] = [];

  for (const name of names) {
    let last = -1;
    lines.forEach((line, index) => {
      if (assignment.exec(line)?.[1] === name) {
        last = index;
      }
    });
    const current = last === -1 ? undefined : lines[last];
    const raw = current === undefined ? undefined : (assignment.exec(current)?.[2] ?? '');
    const replace = replaceToken && name === 'LEDGER_TOKEN';
    if (raw !== undefined && !isEmptyValue(raw) && !replace) {
      continue;
    }
    const line = `${name}=${generate(name)}`;
    if (current === undefined) {
      appended.push(line);
    } else {
      const terminator = current.endsWith('\r\n') ? '\r\n' : current.endsWith('\n') ? '\n' : '';
      lines[last] = `${line}${terminator}`;
    }
    written.push(name);
  }

  let merged = lines.join('');
  if (appended.length > 0) {
    if (merged !== '' && !merged.endsWith('\n')) {
      merged += eol;
    }
    merged += appended.map((line) => `${line}${eol}`).join('');
  }
  return { text: merged, written };
}

// D41: whether setup keeps the current `LEDGER_TOKEN`. It is replaced when it is empty, slice 1's
// placeholder, fails the tag check under the file's tag key, or matches no active row. The tag check
// runs first, so a malformed or forged value never reaches the database (D3); `isActive` is the
// caller's `apiTokensRepository.findActiveByHash` lookup.
export async function isWorkingLocalToken(
  token: string | undefined,
  tagKey: Uint8Array,
  isActive: (tokenHash: string) => Promise<boolean>,
): Promise<boolean> {
  if (token === undefined || token === '' || token === LOOPBACK_PLACEHOLDER_TOKEN) {
    return false;
  }
  if (!hasValidTag(token, tagKey)) {
    return false;
  }
  return isActive(hashApiToken(token));
}
