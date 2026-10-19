import {
  type ApiGatewayV2Client,
  GetApisCommand,
  GetStageCommand,
  type RouteSettings,
} from '@aws-sdk/client-apigatewayv2';
import { LedgerError } from '@ledger/shared';

// Slice 3, D33: how the kill switch and the burst read and write the app stack's HTTP API stage, so
// both do it the same way. Internal to the package, never exported from `index.ts`.

// Slice 2, D35: a `$default` throttle, as the app stack declares it in its `ThrottleRateLimit` and
// `ThrottleBurstLimit` outputs.
export type DeclaredThrottle = { rateLimit: number; burstLimit: number };

// Slice 2, D27: the HTTP API's stage and its physical name, derived from the app stack's name.
export const STAGE_NAME = '$default';
const httpApiName = (appStackName: string): string => `${appStackName}-http`;

export type Stage = {
  apiId: string;
  defaultSettings: RouteSettings | undefined;
  routeSettings: Record<string, RouteSettings>;
};

// The app stack's HTTP API by its physical name, across every `GetApis` page, then its `$default`
// stage. The API's generated id never leaves the package.
export async function readStage(
  apiGateway: ApiGatewayV2Client,
  appStackName: string,
): Promise<Stage> {
  const wanted = httpApiName(appStackName);
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const page = await apiGateway.send(
      new GetApisCommand(nextToken === undefined ? {} : { NextToken: nextToken }),
    );
    for (const api of page.Items ?? []) {
      if (api.Name === wanted && api.ApiId !== undefined) ids.push(api.ApiId);
    }
    nextToken = page.NextToken;
  } while (nextToken !== undefined);
  const apiId = ids.length === 1 ? ids[0] : undefined;
  if (apiId === undefined) {
    throw new LedgerError('internal_error', 'The app stack does not have exactly one HTTP API.');
  }
  const stage = await apiGateway.send(new GetStageCommand({ ApiId: apiId, StageName: STAGE_NAME }));
  return {
    apiId,
    defaultSettings: stage.DefaultRouteSettings,
    routeSettings: stage.RouteSettings ?? {},
  };
}

// A route setting's throttle as read; `null` where the stage sets none.
export type ReadThrottle = { rateLimit: number | null; burstLimit: number | null };

export const throttleOf = (settings: RouteSettings | undefined): ReadThrottle => ({
  rateLimit: settings?.ThrottlingRateLimit ?? null,
  burstLimit: settings?.ThrottlingBurstLimit ?? null,
});

export const hasThrottle = (
  settings: RouteSettings | undefined,
  throttle: DeclaredThrottle,
): boolean =>
  settings?.ThrottlingRateLimit === throttle.rateLimit &&
  settings?.ThrottlingBurstLimit === throttle.burstLimit;

// The throttle replaced, the one other HTTP API route setting (detailed metrics) carried over; the
// logging and data-trace settings apply to WebSocket APIs only.
export const withThrottle = (
  settings: RouteSettings | undefined,
  throttle: DeclaredThrottle,
): RouteSettings => ({
  ...(settings?.DetailedMetricsEnabled === undefined
    ? {}
    : { DetailedMetricsEnabled: settings.DetailedMetricsEnabled }),
  ThrottlingRateLimit: throttle.rateLimit,
  ThrottlingBurstLimit: throttle.burstLimit,
});
