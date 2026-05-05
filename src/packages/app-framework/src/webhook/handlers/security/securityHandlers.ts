import { Duration } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../../lambdaDefaults';

export interface SecurityHandlersProps {
  readonly appId: string;
  readonly nodeId: string;
  readonly installationTokenFunctionName: string;
  readonly installationTokenLambdaArn: string;
  readonly jobsTableName?: string;
  readonly securitySnsTopicArn?: string;
}

export class SecurityHandlers extends Construct {
  readonly secretScanningHandler: NodejsFunction;
  readonly codeScanningHandler: NodejsFunction;
  readonly dependabotHandler: NodejsFunction;
  readonly securityAdvisoryHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: SecurityHandlersProps) {
    super(scope, id);

    const sharedEnv = {
      APP_ID: props.appId,
      NODE_ID: props.nodeId,
      INSTALLATION_TOKEN_FUNCTION_NAME: props.installationTokenFunctionName,
      JOBS_TABLE_NAME: props.jobsTableName || '',
      SECURITY_SNS_TOPIC_ARN: props.securitySnsTopicArn || '',
    };

    const invokePolicy = new PolicyStatement({
      actions: ['lambda:InvokeFunction'],
      effect: Effect.ALLOW,
      resources: [props.installationTokenLambdaArn],
    });

    this.secretScanningHandler = new NodejsFunction(
      this,
      'secretScanningHandler',
      {
        ...LAMBDA_DEFAULTS,
        description: 'Handles secret_scanning_alert events',
        memorySize: 256,
        timeout: Duration.seconds(30),
        environment: sharedEnv,
      },
    );
    this.secretScanningHandler.addToRolePolicy(invokePolicy);

    this.codeScanningHandler = new NodejsFunction(this, 'codeScanningHandler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles code_scanning_alert events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: sharedEnv,
    });
    this.codeScanningHandler.addToRolePolicy(invokePolicy);

    this.dependabotHandler = new NodejsFunction(this, 'dependabotHandler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles dependabot_alert events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: sharedEnv,
    });
    this.dependabotHandler.addToRolePolicy(invokePolicy);

    this.securityAdvisoryHandler = new NodejsFunction(
      this,
      'securityAdvisoryHandler',
      {
        ...LAMBDA_DEFAULTS,
        description: 'Handles security_advisory events (informational)',
        memorySize: 256,
        timeout: Duration.seconds(30),
        environment: sharedEnv,
      },
    );
    this.securityAdvisoryHandler.addToRolePolicy(invokePolicy);
  }
}
