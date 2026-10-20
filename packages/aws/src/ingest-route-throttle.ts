import {
  type ApiGatewayV2Client,
  DeleteRouteSettingsCommand,
  UpdateStageCommand,
} from '@aws-sdk/client-apigatewayv2';
import { GetFunctionConcurrencyCommand, type LambdaClient } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { readStage, STAGE_NAME, withThrottle } from './http-api-stage.ts';
import { KILL_SWITCH_STOP_THROTTLE } from './kill-switch.ts';

// Slice 4 D31: the ingest route's key on the HTTP API stage, `infra`'s `INGEST_PATH` behind `POST`.
export const INGEST_ROUTE_KEY = 'POST /webhooks/resend';

type StageNames = { appStackName: string };

// What the restore did: deleted the route setting, or left it because the stack is tripped, whose
// trip wrote the same values and whose re-arm deletes every route setting (kill-switch.ts).
export type IngestRouteRestore = 'restored' | 'left: tripped';

// The gap drill's preflight: an ingest route setting already exists (a crashed drill, or a trip).
export async function ingestRouteSettingExists(
  apiGateway: ApiGatewayV2Client,
  names: StageNames,
): Promise<boolean> {
  const stage = await readStage(apiGateway, names.appStackName);
  return stage.routeSettings[INGEST_ROUTE_KEY] !== undefined;
}

// Slice 4 D31: the gap drill's lower. A route setting at the kill switch's stop values (0 / 0)
// overrides the stage default for the ingest route alone (AWS-14), so Resend's deliveries fail and
// retry while the read API answers. Refuses an existing setting, which only a re-arm clears.
export async function lowerIngestRouteThrottle(
  apiGateway: ApiGatewayV2Client,
  names: StageNames,
): Promise<void> {
  const stage = await readStage(apiGateway, names.appStackName);
  if (stage.routeSettings[INGEST_ROUTE_KEY] !== undefined) {
    throw new LedgerError('internal_error', 'An ingest route setting exists: run pnpm aws:rearm.');
  }
  await apiGateway.send(
    new UpdateStageCommand({
      ApiId: stage.apiId,
      StageName: STAGE_NAME,
      RouteSettings: { [INGEST_ROUTE_KEY]: withThrottle(undefined, KILL_SWITCH_STOP_THROTTLE) },
    }),
  );
}

// Slice 4 D31: the drill's `finally`. Deletes the ingest route setting only when the stack is not
// tripped (the worker's reserved concurrency is not `0`): a trip mid-drill wrote the same values,
// and deleting them would undo the trip.
export async function restoreIngestRouteThrottle(
  clients: { apiGateway: ApiGatewayV2Client; lambda: LambdaClient },
  names: StageNames,
): Promise<IngestRouteRestore> {
  const worker = await clients.lambda.send(
    new GetFunctionConcurrencyCommand({ FunctionName: `${names.appStackName}-worker` }),
  );
  if (worker.ReservedConcurrentExecutions === 0) return 'left: tripped';
  const stage = await readStage(clients.apiGateway, names.appStackName);
  if (stage.routeSettings[INGEST_ROUTE_KEY] !== undefined) {
    await clients.apiGateway.send(
      new DeleteRouteSettingsCommand({
        ApiId: stage.apiId,
        StageName: STAGE_NAME,
        RouteKey: INGEST_ROUTE_KEY,
      }),
    );
  }
  return 'restored';
}
