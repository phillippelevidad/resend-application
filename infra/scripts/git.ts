import { spawnSync } from 'node:child_process';
import { LedgerError } from '@ledger/shared';

// The deploy command's git reads (D33 steps 1 and 4, and the commit it passes as context). `git` is
// spawned with an argument array and no shell (pp-infra → Running the CDK CLI), in the repository
// the caller names, so a test can point it at a throwaway repository.

function git(cwd: string, args: readonly string[]): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout };
}

// D33 step 1: no tracked file differs from `HEAD`, so `DeployedCommit` names the code deployed.
// Untracked files cannot change what is deployed unless something tracked imports them.
export function isTreeClean(cwd: string): boolean {
  const { status, stdout } = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (status !== 0) throw new LedgerError('internal_error', 'git status failed.');
  return stdout.trim() === '';
}

// The commit being deployed, passed to the app stack as `ledger:commit`.
export function headCommit(cwd: string): string {
  const { status, stdout } = git(cwd, ['rev-parse', 'HEAD']);
  if (status !== 0) throw new LedgerError('internal_error', 'git rev-parse failed.');
  return stdout.trim();
}

// D33 step 4, ADR-018: `git merge-base --is-ancestor <sha> <deployed>` exits 0 only when `sha` is an
// ancestor of the deployed commit. Any other exit (not an ancestor, an unknown commit, a shallow
// clone missing either) answers false, so the deploy refuses: it fails closed.
export function isAncestor(cwd: string, sha: string, deployedCommit: string): boolean {
  return git(cwd, ['merge-base', '--is-ancestor', sha, deployedCommit]).status === 0;
}
