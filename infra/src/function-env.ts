import { apiEnv, ingestEnv, ingestSimulatorEnv, killSwitchEnv, workerEnv } from '@ledger/shared';

// D2: the internal variable values, keyed by the names `@ledger/shared` declares and each function's
// `.config.ts` parses. Each builder returns exactly its object's keys, so the type checker refuses a
// missing one and the stack tests refuse an extra one. Every value is an ARN, URL or name, never a
// secret (CBL-01); no key is Lambda-reserved (AWS-56).

type EnvOf<Names extends Readonly<Record<string, string>>> = Record<Names[keyof Names], string>;

export const ingestEnvironment = (values: {
  signingSecretsArn: string;
  queueUrl: string;
}): EnvOf<typeof ingestEnv> => ({
  [ingestEnv.SIGNING_SECRETS_ARN]: values.signingSecretsArn,
  [ingestEnv.QUEUE_URL]: values.queueUrl,
});

// Slice 3, D12: merged into ingest's environment only when the stack has the simulator on.
export const ingestSimulatorEnvironment = (values: {
  simulatorSecretArn: string;
}): EnvOf<typeof ingestSimulatorEnv> => ({
  [ingestSimulatorEnv.SIMULATOR_SECRET_ARN]: values.simulatorSecretArn,
});

export const workerEnvironment = (values: {
  databaseSecretArn: string;
}): EnvOf<typeof workerEnv> => ({
  [workerEnv.DATABASE_SECRET_ARN]: values.databaseSecretArn,
});

export const apiEnvironment = (values: {
  databaseSecretArn: string;
  queueUrl: string;
  dlqUrl: string;
  workerFunctionName: string;
}): EnvOf<typeof apiEnv> => ({
  [apiEnv.DATABASE_SECRET_ARN]: values.databaseSecretArn,
  [apiEnv.QUEUE_URL]: values.queueUrl,
  [apiEnv.DLQ_URL]: values.dlqUrl,
  [apiEnv.WORKER_FUNCTION_NAME]: values.workerFunctionName,
});

export const killSwitchEnvironment = (values: {
  appStackName: string;
  alertTopicArn: string;
}): EnvOf<typeof killSwitchEnv> => ({
  [killSwitchEnv.APP_STACK_NAME]: values.appStackName,
  [killSwitchEnv.ALERT_TOPIC_ARN]: values.alertTopicArn,
});
