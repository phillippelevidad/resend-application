import { Stack, type StackProps, Validations } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

// Empty until slice 2 adds the functions, queues and secrets (ADR-001, ADR-002, ADR-008, ADR-010).
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    // Synthesis rejects a stack with no resources (F0001). Slice 2 removes this with the first one.
    Validations.of(this).acknowledge({
      id: 'CloudFormation-Validate::F0001',
      reason: 'Empty until slice 2; the CDK CLI skips deploying a stack with no resources.',
    });
  }
}
