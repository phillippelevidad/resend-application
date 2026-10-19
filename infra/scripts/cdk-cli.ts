import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// The `infra` project folder: `cdk.json` is there, so the CLI runs with it as its working directory.
export const INFRA_DIR = fileURLToPath(new URL('..', import.meta.url));

// The repository root, where git runs.
export const REPO_DIR = fileURLToPath(new URL('../..', import.meta.url));

// The synthesized cloud assembly, `cdk.json`'s `output` (git-ignored, CBL-19).
export const CDK_OUT_DIR = fileURLToPath(new URL('../cdk.out', import.meta.url));

// pp-infra → Running the CDK CLI, D33: the CLI's JavaScript entry, resolved from the lockfile's
// `aws-cdk` (2.1145.0 exports `./bin/cdk`), run by Node itself: no `.cmd` shim, no shell.
const CDK_ENTRY = createRequire(import.meta.url).resolve('aws-cdk/bin/cdk');

// The child keeps the AWS credentials and region the SDK and CDK read, and drops every Ledger value
// `.env.local` loaded (database URLs, keys, signing secrets): the CDK app reads only context.
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith('LEDGER_') && name !== 'DATABASE_URL'),
  );
}

// The command line as the log shows it: the alert address is left out together with the `-c` that
// introduces it, so the line never reads `-c -c …`.
export function loggedArgs(args: readonly string[]): string[] {
  const shown: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg.startsWith('ledger:alertEmail=')) continue;
    if (arg === '-c' && args[index + 1]?.startsWith('ledger:alertEmail=')) continue;
    shown.push(arg);
  }
  return shown;
}

// Runs one CDK CLI command and resolves its exit code. Its output goes to `logFile`, never to the
// terminal: `cdk deploy` prints stack ARNs, which carry the account id no script line may show
// (deploy-and-teardown spec → Script output carries no secret). The caller names the file on failure.
// `env` is the script's own environment, which its composition root passes in.
export function runCdk(
  args: readonly string[],
  logFile: string,
  env: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logFile, { flags: 'a' });
    log.write(`\n$ cdk ${loggedArgs(args).join(' ')}\n`);
    const child = spawn(process.execPath, [CDK_ENTRY, ...args], {
      cwd: INFRA_DIR,
      env: childEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => {
      log.end();
      reject(error);
    });
    child.on('close', (code) => {
      log.end(() => resolve(code ?? 1));
    });
  });
}
