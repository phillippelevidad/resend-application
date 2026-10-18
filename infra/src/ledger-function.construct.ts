import { join } from 'node:path';
import { type Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, LoggingFormat, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

// The repository root, from this file's own location (infra/src): the entry paths, the lockfile and
// the project root esbuild bundles from (pp-infra → cdk-app.md → Bundling).
export const REPO_ROOT = join(import.meta.dirname, '..', '..');

// AWS-29, AWS-40: every function's log group keeps 30 days, then expires.
export const LOG_RETENTION = RetentionDays.ONE_MONTH;

// D32: a CommonJS dependency bundled into the ES-module output calls `require()` for Node built-ins,
// which esbuild's shim refuses at load ("Dynamic require of "util" is not supported", esbuild #1921).
// `bundle-smoke.test.ts` failed on exactly that for all four functions on 2026-10-17 (Winston's
// `@colors/colors` requires `util`); the documented remedy defines `require` for the bundle. `pg-native`
// needed no external: every bundle builds and loads without it.
export const ESM_REQUIRE_BANNER =
  "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

export type LedgerFunctionProps = {
  // The `apps/<app>` folder; its entry is `apps/<app>/src/<app>.handler.ts`, exporting `handler`.
  readonly app: string;
  // The stack-prefixed physical name the kill switch finds it by (D27, aws.md → Budget alarms item 1).
  readonly functionName: string;
  readonly memorySize: number;
  readonly timeout: Duration;
  // The internal variables of `function-env.ts`, set on this function only (D2).
  readonly environment: Readonly<Record<string, string>>;
};

// D27, O-15: the one function shape, so every cost-brake property holds on every function by
// construction (pp-infra → Cost brake in code). No VPC (AWS-13) and no reserved or provisioned
// concurrency (AWS-16) are set because neither prop is ever passed.
export class LedgerFunction extends Construct {
  readonly fn: NodejsFunction;
  readonly logGroup: LogGroup;

  constructor(scope: Construct, id: string, props: LedgerFunctionProps) {
    super(scope, id);

    // AWS-19, AWS-38, AWS-40: an explicit group, so the runtime never creates `/aws/lambda/<name>`
    // (kept forever), and destroyed with the stack (a log group defaults to RETAIN).
    this.logGroup = new LogGroup(this, 'LogGroup', {
      logGroupName: `/ledger/${props.functionName}`,
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.fn = new NodejsFunction(this, 'Function', {
      functionName: props.functionName,
      entry: join(REPO_ROOT, 'apps', props.app, 'src', `${props.app}.handler.ts`),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X, // AWS-54
      architecture: Architecture.ARM_64, // AWS-20
      memorySize: props.memorySize,
      timeout: props.timeout,
      environment: { ...props.environment },
      logGroup: this.logGroup,
      // D31: one JSON object per line from the logger, and EMF on stdout, both parsed under TEXT; no
      // level filter applies, so Winston's lowercase levels are never dropped (C15).
      loggingFormat: LoggingFormat.TEXT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      projectRoot: REPO_ROOT,
      // AWS-55: local esbuild (the root devDependency), never Docker. ES modules, target written out
      // beside the runtime, the AWS SDK bundled from the lockfile rather than taken from the runtime.
      // Minify and source maps stay off until a measured `Init Duration` says otherwise (CBL-21).
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        bundleAwsSDK: true,
        banner: ESM_REQUIRE_BANNER,
      },
    });
  }
}
