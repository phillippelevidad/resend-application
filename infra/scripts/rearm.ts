import { parseArgs } from 'node:util';
import {
  createApiGatewayV2Client,
  createBudgetsClient,
  createCloudFormationClient,
  createLambdaClient,
  readBudgetSpend,
  readStackOutputs,
  restoreFromTrip,
} from '@ledger/aws';
import {
  APP_STACK_NAME,
  appOutputKeys,
  GUARDRAILS_STACK_NAME,
  guardrailsOutputKeys,
  MONTHLY_BUDGET_NAME,
} from './ledger-stacks.ts';
import { createScriptOutput, processSink } from './script-output.ts';

// `pnpm aws:rearm` (D35, aws.md → Budget alarms item 6): undo a trip with the kill switch's own
// restore steps (`restoreFromTrip`, shared with the trip drill), then warn when this month's actual
// spend is at or above the budget, which does not alert again this month (AWS-34), then point at
// the reconcile. The spend is read from the budget itself (`DescribeBudget`), whose cost is AWS-58.
// Each run is the owner's Ask-first run (root AGENTS.md → Permissions).

const out = createScriptOutput('aws:rearm', processSink);
const cloudFormation = createCloudFormationClient();
const lambda = createLambdaClient();
const apiGateway = createApiGatewayV2Client();
const budgets = createBudgetsClient();

async function rearm(): Promise<0 | 1> {
  try {
    parseArgs({ args: process.argv.slice(2), options: {}, strict: true, allowPositionals: false });
  } catch {
    return out.refused('usage: pnpm aws:rearm');
  }

  let appOutputs: Readonly<Record<string, string>>;
  let guardrailsOutputs: Readonly<Record<string, string>>;
  try {
    const app = await readStackOutputs(cloudFormation, APP_STACK_NAME);
    const guardrails = await readStackOutputs(cloudFormation, GUARDRAILS_STACK_NAME);
    if (app === null) return out.refused('no app stack is deployed; there is nothing to re-arm');
    if (guardrails === null) {
      return out.refused('no guardrails stack is deployed; run pnpm aws:deploy first');
    }
    appOutputs = app.outputs;
    guardrailsOutputs = guardrails.outputs;
  } catch {
    return out.failed('reading the deployed stacks failed');
  }

  // D35: the `$default` throttle the app stack declares, from its outputs.
  const declared = {
    rateLimit: Number(appOutputs[appOutputKeys.throttleRateLimit]),
    burstLimit: Number(appOutputs[appOutputKeys.throttleBurstLimit]),
  };
  if (!Number.isFinite(declared.rateLimit) || !Number.isFinite(declared.burstLimit)) {
    return out.failed("the app stack's throttle outputs are missing");
  }

  try {
    const report = await restoreFromTrip(
      { lambda, apiGateway },
      { appStackName: APP_STACK_NAME },
      declared,
    );
    out.line(
      report.changed.length === 0
        ? 'restored: nothing to change, the stack was not tripped'
        : `restored: ${report.changed.join(', ')}`,
    );
    out.line(`event source ${report.state.eventSource}`);
    out.line(
      `${report.state.functions.length} function(s) without reserved concurrency; throttle rate ${declared.rateLimit}, burst ${declared.burstLimit}`,
    );
  } catch {
    return out.failed(
      'restoring from the trip failed; rerun pnpm aws:rearm, each step reads first',
    );
  }

  // `DescribeBudget` takes the account id, read from the trip topic's ARN
  // (`arn:aws:sns:<region>:<account>:<name>`) and never printed.
  const accountId = guardrailsOutputs[guardrailsOutputKeys.tripTopicArn]?.split(':')[4];
  if (accountId === undefined || accountId === '') {
    return out.failed("the guardrails stack's trip topic output is missing; the stack is restored");
  }
  try {
    const spend = await readBudgetSpend(budgets, { accountId, budgetName: MONTHLY_BUDGET_NAME });
    out.line(`month-to-date actual spend ${spend.actual} of ${spend.limit} ${spend.unit}`);
    if (spend.actual >= spend.limit) {
      out.line(
        'warning: actual spend is at or above the budget, which does not trip again this month (AWS-34); until next month only the usage trip remains re-armable',
      );
    }
  } catch {
    return out.failed("reading the budget's spend failed; the stack is restored");
  }

  out.line('then: ledger reconcile → slice 4');
  return out.done();
}

process.exitCode = await rearm();
