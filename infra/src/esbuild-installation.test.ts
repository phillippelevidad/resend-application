// D32, AWS-55: `NodejsFunction` bundles with a local esbuild when it finds one and otherwise falls
// back to a Docker container silently. This fails the gate instead: the repository root resolves the
// pinned root devDependency, and aws-cdk-lib's own lookup (`require('esbuild/package.json')` from its
// `aws-lambda-nodejs` module, which then runs the workspace's `esbuild` binary from the project root)
// finds an installation, so it never reaches the Docker branch.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './ledger-function.construct.ts';

const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  devDependencies?: Record<string, string>;
};

describe('the esbuild installation CDK bundles with (AWS-55)', () => {
  it('pins esbuild exactly as a root devDependency', () => {
    expect(rootManifest.devDependencies?.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('resolves the pinned esbuild from the repository root', () => {
    const fromRoot = createRequire(join(REPO_ROOT, 'package.json'));
    const installed = fromRoot('esbuild/package.json') as { version: string };
    expect(installed.version).toBe(rootManifest.devDependencies?.esbuild);
  });

  it("finds an esbuild from aws-cdk-lib's own lookup, so bundling stays local", () => {
    const lambdaNodejs = createRequire(import.meta.url).resolve('aws-cdk-lib/aws-lambda-nodejs');
    const found = createRequire(lambdaNodejs)('esbuild/package.json') as { version: string };
    // aws-cdk-lib accepts any 0.x (ESBUILD_MAJOR_VERSION); the binary it runs is the root's.
    expect(found.version).toMatch(/^0\./);
  });
});
