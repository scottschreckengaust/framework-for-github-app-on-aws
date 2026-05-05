import { Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface CheckRunStepProps {
  readonly appId: string;
  readonly nodeId: string;
  readonly installationTokenFunctionName: string;
  readonly installationTokenLambdaArn: string;
  readonly userTokensTableName?: string;
  readonly tokenEncryptionKeyArn?: string;
}

export class CheckRunStep extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: CheckRunStepProps) {
    super(scope, id);
    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Step Functions step: create/complete GitHub Check Run',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        APP_ID: props.appId,
        NODE_ID: props.nodeId,
        INSTALLATION_TOKEN_FUNCTION_NAME: props.installationTokenFunctionName,
        USER_TOKENS_TABLE_NAME: props.userTokensTableName || '',
        TOKEN_ENCRYPTION_KEY_ARN: props.tokenEncryptionKeyArn || '',
      },
    });

    this.lambdaHandler.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        effect: Effect.ALLOW,
        resources: [props.installationTokenLambdaArn],
      }),
    );

    if (props.userTokensTableName) {
      this.lambdaHandler.addToRolePolicy(
        new PolicyStatement({
          actions: ['dynamodb:GetItem'],
          effect: Effect.ALLOW,
          resources: [
            `arn:aws:dynamodb:*:*:table/${props.userTokensTableName}`,
          ],
        }),
      );
    }

    if (props.tokenEncryptionKeyArn) {
      this.lambdaHandler.addToRolePolicy(
        new PolicyStatement({
          actions: ['kms:Decrypt'],
          effect: Effect.ALLOW,
          resources: [props.tokenEncryptionKeyArn],
        }),
      );
    }
  }
}
