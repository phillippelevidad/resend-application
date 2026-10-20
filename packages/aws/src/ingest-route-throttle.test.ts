// Slice 4 D31: the gap drill's ingest route throttle over stubbed API Gateway and Lambda clients
// holding the app stack's stage and the worker's concurrency. The commands sent are the consequence
// at this seam. Route-setting semantics: AWS-14.
import type { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import type { LambdaClient } from '@aws-sdk/client-lambda';
import { LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import {
  INGEST_ROUTE_KEY,
  ingestRouteSettingExists,
  lowerIngestRouteThrottle,
  restoreIngestRouteThrottle,
} from './ingest-route-throttle.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const apiId = 'a1b2c3d4e5';
const names = { appStackName: 'LedgerApp' };

type Settings = { ThrottlingRateLimit?: number; ThrottlingBurstLimit?: number };

const apiGatewayHolding = (routeSettings: Record<string, Settings>) =>
  new StubClient()
    .answer('GetApis', () => ({ Items: [{ Name: 'LedgerApp-http', ApiId: apiId }], ...metadata }))
    .answer('GetStage', () => ({
      StageName: '$default',
      DefaultRouteSettings: { ThrottlingRateLimit: 100, ThrottlingBurstLimit: 200 },
      RouteSettings: structuredClone(routeSettings),
      ...metadata,
    }))
    .answer('UpdateStage', () => metadata)
    .answer('DeleteRouteSettings', () => metadata);

const lambdaWithWorkerConcurrency = (reserved: number | undefined) =>
  new StubClient().answer('GetFunctionConcurrency', () => ({
    ...(reserved === undefined ? {} : { ReservedConcurrentExecutions: reserved }),
    ...metadata,
  }));

const sentNames = (stub: StubClient) => stub.sent.map((command) => command.name);

describe('the ingest route throttle (D31)', () => {
  it('refuses to lower over an existing ingest route setting, sending no update', async () => {
    const apiGateway = apiGatewayHolding({
      [INGEST_ROUTE_KEY]: { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
    });

    const failure = await lowerIngestRouteThrottle(
      apiGateway.as<ApiGatewayV2Client>(),
      names,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).message).toBe(
      'An ingest route setting exists: run pnpm aws:rearm.',
    );
    expect(sentNames(apiGateway)).not.toContain('UpdateStage');
    expect(await ingestRouteSettingExists(apiGateway.as<ApiGatewayV2Client>(), names)).toBe(true);
  });

  it('lowers the ingest route alone to the stop values 0 / 0', async () => {
    const apiGateway = apiGatewayHolding({});

    await lowerIngestRouteThrottle(apiGateway.as<ApiGatewayV2Client>(), names);

    const update = apiGateway.sent.find((command) => command.name === 'UpdateStage');
    expect(update?.input).toEqual({
      ApiId: apiId,
      StageName: '$default',
      RouteSettings: {
        [INGEST_ROUTE_KEY]: { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
      },
    });
  });

  it('restores by deleting the ingest route setting on an untripped stack', async () => {
    const apiGateway = apiGatewayHolding({
      [INGEST_ROUTE_KEY]: { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
    });

    const result = await restoreIngestRouteThrottle(
      {
        apiGateway: apiGateway.as<ApiGatewayV2Client>(),
        lambda: lambdaWithWorkerConcurrency(undefined).as<LambdaClient>(),
      },
      names,
    );

    expect(result).toBe('restored');
    const deleted = apiGateway.sent.find((command) => command.name === 'DeleteRouteSettings');
    expect(deleted?.input).toEqual({
      ApiId: apiId,
      StageName: '$default',
      RouteKey: INGEST_ROUTE_KEY,
    });
  });

  it('leaves the setting on a tripped stack (worker concurrency 0), sending no delete', async () => {
    const apiGateway = apiGatewayHolding({
      [INGEST_ROUTE_KEY]: { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 },
    });
    const lambda = lambdaWithWorkerConcurrency(0);

    const result = await restoreIngestRouteThrottle(
      { apiGateway: apiGateway.as<ApiGatewayV2Client>(), lambda: lambda.as<LambdaClient>() },
      names,
    );

    expect(result).toBe('left: tripped');
    expect(sentNames(apiGateway)).not.toContain('DeleteRouteSettings');
    expect(lambda.sent[0]?.input).toEqual({ FunctionName: 'LedgerApp-worker' });
  });
});
