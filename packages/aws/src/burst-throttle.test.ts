// D25 steps 4 and 8, Ships 4: the burst's throttle raise and its conditional restore, over a stubbed
// API Gateway client holding the app stack's HTTP API stage. The commands sent are the consequence
// at this seam; the stage they leave is asserted too. Error names from the UpdateStage reference
// (https://docs.aws.amazon.com/apigatewayv2/latest/api-reference/apis-apiid-stages-stagename.html).
import { type ApiGatewayV2Client, BadRequestException } from '@aws-sdk/client-apigatewayv2';
import { LedgerError } from '@ledger/shared';
import { describe, expect, it } from 'vitest';
import {
  BURST_THROTTLE,
  raiseDefaultThrottle,
  restoreDefaultThrottleIf,
} from './burst-throttle.ts';
import { StubClient } from './testing/stub-client.ts';

const metadata = { $metadata: {} };
const apiId = 'a1b2c3d4e5';
const names = { appStackName: 'LedgerApp' };
const declared = { rateLimit: 100, burstLimit: 200 };

type Settings = {
  ThrottlingRateLimit?: number;
  ThrottlingBurstLimit?: number;
  DetailedMetricsEnabled?: boolean;
};

type StageState = { defaultSettings: Settings; routeSettings: Record<string, Settings> };

// A steady stage: the declared throttle, detailed metrics off, no route setting.
const steadyStage = (): StageState => ({
  defaultSettings: {
    DetailedMetricsEnabled: false,
    ThrottlingRateLimit: declared.rateLimit,
    ThrottlingBurstLimit: declared.burstLimit,
  },
  routeSettings: {},
});

const apiGatewayHolding = (stage: StageState) =>
  new StubClient()
    .answer('GetApis', () => ({
      Items: [
        { Name: 'other-http', ApiId: 'zzzzzzzzzz' },
        { Name: 'LedgerApp-http', ApiId: apiId },
      ],
      ...metadata,
    }))
    .answer('GetStage', () => ({
      StageName: '$default',
      DefaultRouteSettings: { ...stage.defaultSettings },
      RouteSettings: structuredClone(stage.routeSettings),
      ...metadata,
    }))
    .answer('UpdateStage', (input) => {
      if (input.DefaultRouteSettings !== undefined) {
        stage.defaultSettings = input.DefaultRouteSettings as Settings;
      }
      return metadata;
    });

const client = (stub: StubClient) => stub.as<ApiGatewayV2Client>();

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

describe('raiseDefaultThrottle', () => {
  it('raises the $default default-route throttle to 1200/2400 and records the value it set', async () => {
    const stage = steadyStage();
    const apiGateway = apiGatewayHolding(stage);

    const raised = await raiseDefaultThrottle(client(apiGateway), names);

    expect(raised).toEqual({ rateLimit: 1200, burstLimit: 2400 });
    expect(BURST_THROTTLE).toEqual(raised);
    expect(apiGateway.inputs('UpdateStage')).toEqual([
      {
        ApiId: apiId,
        StageName: '$default',
        DefaultRouteSettings: {
          DetailedMetricsEnabled: false,
          ThrottlingRateLimit: 1200,
          ThrottlingBurstLimit: 2400,
        },
      },
    ]);
    expect(stage.defaultSettings).toMatchObject({
      ThrottlingRateLimit: 1200,
      ThrottlingBurstLimit: 2400,
    });
  });

  it('refuses a tripped stage (the stop values 0/0) and sends no update', async () => {
    const stage = steadyStage();
    stage.defaultSettings = { ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 };
    const apiGateway = apiGatewayHolding(stage);

    const failure = await failureOf(raiseDefaultThrottle(client(apiGateway), names));

    expect(failure).toBeInstanceOf(LedgerError);
    expect((failure as LedgerError).code).toBe('internal_error');
    expect(apiGateway.names()).not.toContain('UpdateStage');
    expect(stage.defaultSettings).toEqual({ ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 });
  });

  it('refuses a stage whose route throttle reads the stop values, and sends no update', async () => {
    const stage = steadyStage();
    stage.routeSettings['POST /webhooks/resend'] = {
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    };
    const apiGateway = apiGatewayHolding(stage);

    expect(await failureOf(raiseDefaultThrottle(client(apiGateway), names))).toBeInstanceOf(
      LedgerError,
    );
    expect(apiGateway.names()).not.toContain('UpdateStage');
  });

  it('rejects with the SDK error unchanged when the update fails (BadRequestException)', async () => {
    const error = new BadRequestException({ message: 'x', ...metadata });
    const apiGateway = apiGatewayHolding(steadyStage()).answer('UpdateStage', () => {
      throw error;
    });

    expect(await failureOf(raiseDefaultThrottle(client(apiGateway), names))).toBe(error);
  });
});

describe('restoreDefaultThrottleIf', () => {
  it('restores the declared throttle when the stage still reads the raised value', async () => {
    const stage = steadyStage();
    const apiGateway = apiGatewayHolding(stage);
    const raised = await raiseDefaultThrottle(client(apiGateway), names);

    const result = await restoreDefaultThrottleIf(client(apiGateway), names, raised, declared);

    expect(result).toEqual({ status: 'restored', throttle: declared });
    expect(apiGateway.inputs('UpdateStage').at(-1)).toEqual({
      ApiId: apiId,
      StageName: '$default',
      DefaultRouteSettings: {
        DetailedMetricsEnabled: false,
        ThrottlingRateLimit: 100,
        ThrottlingBurstLimit: 200,
      },
    });
    expect(stage).toEqual(steadyStage());
  });

  it('the stage changes to 0/0 mid-run (a trip): no update is sent, and the result says left with 0/0', async () => {
    const stage = steadyStage();
    const apiGateway = apiGatewayHolding(stage);
    const raised = await raiseDefaultThrottle(client(apiGateway), names);
    // The kill switch trips during the burst (D29 step 3).
    stage.defaultSettings = {
      DetailedMetricsEnabled: false,
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    };
    const updatesBefore = apiGateway.inputs('UpdateStage').length;

    const result = await restoreDefaultThrottleIf(client(apiGateway), names, raised, declared);

    expect(result).toEqual({ status: 'left', throttle: { rateLimit: 0, burstLimit: 0 } });
    expect(apiGateway.inputs('UpdateStage')).toHaveLength(updatesBefore);
    expect(stage.defaultSettings).toMatchObject({
      ThrottlingRateLimit: 0,
      ThrottlingBurstLimit: 0,
    });
  });

  it('a stage with no default throttle reads as left with nulls, and no update is sent', async () => {
    const stage: StageState = { defaultSettings: {}, routeSettings: {} };
    const apiGateway = apiGatewayHolding(stage);

    const result = await restoreDefaultThrottleIf(
      client(apiGateway),
      names,
      BURST_THROTTLE,
      declared,
    );

    expect(result).toEqual({ status: 'left', throttle: { rateLimit: null, burstLimit: null } });
    expect(apiGateway.names()).not.toContain('UpdateStage');
  });
});
