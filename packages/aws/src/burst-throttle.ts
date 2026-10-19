import { type ApiGatewayV2Client, UpdateStageCommand } from '@aws-sdk/client-apigatewayv2';
import { LedgerError } from '@ledger/shared';
import {
  type DeclaredThrottle,
  hasThrottle,
  type ReadThrottle,
  readStage,
  STAGE_NAME,
  throttleOf,
  withThrottle,
} from './http-api-stage.ts';
import { KILL_SWITCH_STOP_THROTTLE } from './kill-switch.ts';

// The stage's default-route throttle as read; `null` where the stage sets none.
export type { ReadThrottle } from './http-api-stage.ts';

// D25 step 4: the burst's `$default` throttle. 1.2× the ceiling burst's mean rate of 1,000 rps, and
// two seconds of tokens, so a best-effort throttle (AWS-14) does not reject a paced burst.
export const BURST_THROTTLE: DeclaredThrottle = { rateLimit: 1200, burstLimit: 2400 };

// What the burst's `finally` did: restored the declared throttle, or left the stage as it read,
// because something else changed it during the burst (a kill-switch trip sets the stop values).
export type ThrottleRestore =
  | { readonly status: 'restored'; readonly throttle: DeclaredThrottle }
  | { readonly status: 'left'; readonly throttle: ReadThrottle };

type StageNames = { appStackName: string };

// D25 step 4: raise the app stack's `$default` default-route throttle to `BURST_THROTTLE` and return
// the value set, which the restore compares against. A tripped stage (any throttle at the kill
// switch's stop values, D29 step 3) is refused before any update: raising it would undo the trip.
export async function raiseDefaultThrottle(
  apiGateway: ApiGatewayV2Client,
  names: StageNames,
): Promise<DeclaredThrottle> {
  const stage = await readStage(apiGateway, names.appStackName);
  const settings = [stage.defaultSettings, ...Object.values(stage.routeSettings)];
  if (settings.some((setting) => hasThrottle(setting, KILL_SWITCH_STOP_THROTTLE))) {
    throw new LedgerError(
      'internal_error',
      "The HTTP API stage is at the kill switch's stop throttle: the stack is tripped.",
    );
  }
  const raised = { ...BURST_THROTTLE };
  await apiGateway.send(
    new UpdateStageCommand({
      ApiId: stage.apiId,
      StageName: STAGE_NAME,
      DefaultRouteSettings: withThrottle(stage.defaultSettings, raised),
    }),
  );
  return raised;
}

// D25 steps 4 and 8: the burst's `finally`. Restores the declared throttle only when the stage still
// reads the value the raise set; anything else (a trip mid-burst) is left exactly as read, with no
// update sent, so the restore never undoes a change it did not make.
export async function restoreDefaultThrottleIf(
  apiGateway: ApiGatewayV2Client,
  names: StageNames,
  raised: DeclaredThrottle,
  declared: DeclaredThrottle,
): Promise<ThrottleRestore> {
  const stage = await readStage(apiGateway, names.appStackName);
  if (!hasThrottle(stage.defaultSettings, raised)) {
    return { status: 'left', throttle: throttleOf(stage.defaultSettings) };
  }
  await apiGateway.send(
    new UpdateStageCommand({
      ApiId: stage.apiId,
      StageName: STAGE_NAME,
      DefaultRouteSettings: withThrottle(stage.defaultSettings, declared),
    }),
  );
  return { status: 'restored', throttle: { ...declared } };
}
