import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { BudgetsClient } from '@aws-sdk/client-budgets';
import { CloudFormationClient } from '@aws-sdk/client-cloudformation';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ResourceGroupsTaggingAPIClient } from '@aws-sdk/client-resource-groups-tagging-api';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

// D26: one factory per approved client, called once at module scope by each composition root, so no
// app, script or `infra/` file imports `@aws-sdk/*` (root AGENTS.md → Module boundaries). Region and
// credentials come from the environment the SDK reads: the Lambda runtime's `AWS_REGION` (AWS-56), or
// the deploying shell's profile for a script. Code outside this package types a client as the
// factory's return type.

export const createSqsClient = (): SQSClient => new SQSClient({});

export const createSecretsManagerClient = (): SecretsManagerClient => new SecretsManagerClient({});

export const createLambdaClient = (): LambdaClient => new LambdaClient({});

export const createCloudWatchClient = (): CloudWatchClient => new CloudWatchClient({});

export const createApiGatewayV2Client = (): ApiGatewayV2Client => new ApiGatewayV2Client({});

export const createCloudFormationClient = (): CloudFormationClient => new CloudFormationClient({});

export const createResourceGroupsTaggingClient = (): ResourceGroupsTaggingAPIClient =>
  new ResourceGroupsTaggingAPIClient({});

export const createCloudWatchLogsClient = (): CloudWatchLogsClient => new CloudWatchLogsClient({});

export const createBudgetsClient = (): BudgetsClient => new BudgetsClient({});

export const createSnsClient = (): SNSClient => new SNSClient({});
