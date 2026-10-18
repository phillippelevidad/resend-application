import {
  createApiGatewayV2Client,
  createLambdaClient,
  createSnsClient,
  type KillSwitchClients,
  tripKillSwitch,
} from '@ledger/aws';
import { createLogger, loadConfig } from '@ledger/shared';
import type { InvocationFields } from './create-kill-switch-handler.ts';
import { killSwitchConfigSchema } from './kill-switch.config.ts';

// Composition root of the kill switch Lambda (ADR-013, D29). Everything here runs once per
// container, at module scope (D32): the config parse and the clients. Nothing here makes a network
// call, so importing the bundle needs no AWS access (D32's smoke check). The trip steps live in
// `@ledger/aws`, shared with the re-arm and the trip drill (D35, D36).

const config = loadConfig(killSwitchConfigSchema, process.env);

// D6: refreshed by the handler at the start of each invocation and merged into every log line.
export const invocation: InvocationFields = { request_id: undefined, cold_start: true };
export const logger = createLogger({ functionName: 'kill-switch', context: () => invocation });

const clients: KillSwitchClients = {
  lambda: createLambdaClient(),
  apiGateway: createApiGatewayV2Client(),
  sns: createSnsClient(),
};

export const trip = () =>
  tripKillSwitch(clients, {
    appStackName: config.appStackName,
    alertTopicArn: config.alertTopicArn,
  });
