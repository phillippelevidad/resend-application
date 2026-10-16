import { describe, expect, it } from 'vitest';
import { createOutput } from './create-output.ts';
import { createProgram } from './create-program.ts';
import { exitCodeFor } from './exit-code-for.ts';

// The real program through the same entry and exit mapping main.ts uses, over in-memory streams.
async function run(args: string[]) {
  let stdout = '';
  let stderr = '';
  const output = createOutput({
    stdout: { write: (chunk: string) => (stdout += chunk) },
    stderr: { write: (chunk: string) => (stderr += chunk) },
  });
  let exitCode = 0;
  try {
    await createProgram({ output }).parseAsync(['node', 'ledger', ...args]);
  } catch (err) {
    exitCode = exitCodeFor(err, output);
  }
  return { exitCode, stdout, stderr };
}

describe('ledger program', () => {
  it('prints help on stdout and exits 0 for --help', async () => {
    const result = await run(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: ledger');
    expect(result.stderr).toBe('');
  });

  it('exits 2 with commander message on stderr for an unknown option', async () => {
    const result = await run(['--bogus']);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain("unknown option '--bogus'");
  });
});
