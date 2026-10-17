// D31: the names `pnpm db:setup` owns in `.env.local`, in the order it writes them.
export const localEnvNames = [
  'DATABASE_URL',
  'LEDGER_ADDRESS_HASH_KEY',
  'LEDGER_SIMULATOR_SECRET',
  'LEDGER_URL',
  'LEDGER_TOKEN',
] as const;

export type LocalEnvName = (typeof localEnvNames)[number];

export type MergedLocalEnv = {
  // The new file text.
  text: string;
  // The names written, in `localEnvNames` order, so the caller prints one line per name and never a
  // value.
  written: LocalEnvName[];
};

// `NAME=value` or `export NAME=value`, the value up to the line terminator.
const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*?)\r?\n?$/;

// Empty as `node --env-file` reads it: nothing, a pair of empty quotes, or only a comment.
function isEmptyValue(raw: string): boolean {
  const value = raw.trim();
  return value === '' || value === '""' || value === "''" || value.startsWith('#');
}

// D31: for each of `localEnvNames`, write `NAME=<generate(NAME)>` only when the name is absent or
// its value is empty. A set value is never overwritten, and every other line, comment and line
// terminator is kept as it was. An empty assignment is filled in place; an absent name is appended.
// When a name is assigned twice, the last assignment is the one `node --env-file` uses, so it is the
// one read and filled. Pure: the caller reads and writes the file.
export function mergeLocalEnv(
  text: string,
  generate: (name: LocalEnvName) => string,
): MergedLocalEnv {
  // Each line keeps its own terminator, so joining them back reproduces the text exactly.
  const lines = text === '' ? [] : text.split(/(?<=\n)/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const written: LocalEnvName[] = [];
  const appended: string[] = [];

  for (const name of localEnvNames) {
    let last = -1;
    lines.forEach((line, index) => {
      if (assignment.exec(line)?.[1] === name) {
        last = index;
      }
    });
    const current = last === -1 ? undefined : lines[last];
    const raw = current === undefined ? undefined : (assignment.exec(current)?.[2] ?? '');
    if (raw !== undefined && !isEmptyValue(raw)) {
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
