// @ledger/app-cli: the `ledger` CLI, built on the SDK. Composition root (pp-cli).
import { createOutput } from './create-output.ts';
import { createProgram } from './create-program.ts';
import { exitCodeFor } from './exit-code-for.ts';

const output = createOutput({ stdout: process.stdout, stderr: process.stderr });
// Exit through process.exitCode only (pp-cli): a piped write is asynchronous on POSIX and an
// early exit can drop it.
const setExitCode = (code: number): void => {
  process.exitCode = code;
};
const program = createProgram({ output });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  setExitCode(exitCodeFor(err, output));
}
