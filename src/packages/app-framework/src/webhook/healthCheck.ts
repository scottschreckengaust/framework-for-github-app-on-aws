import { Duration } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../lambdaDefaults';

export interface HealthCheckProps {
  readonly appId: string;
  readonly appTokenFunctionName: string;
  readonly appTokenLambdaArn: string;
}

export class HealthCheck extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: HealthCheckProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Health check: verifies Credential Manager + GitHub API connectivity',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        APP_TOKEN_FUNCTION_NAME: props.appTokenFunctionName,
        APP_ID: props.appId,
      },
    });

    this.lambdaHandler.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        effect: Effect.ALLOW,
        resources: [props.appTokenLambdaArn],
      }),
    );

    new Rule(this, 'Schedule', {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(this.lambdaHandler)],
    });
  }
}
