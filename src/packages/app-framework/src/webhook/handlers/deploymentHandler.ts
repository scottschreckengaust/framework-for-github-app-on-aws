import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface DeploymentHandlerProps {
  readonly jobsTableName?: string;
}

export class DeploymentHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: DeploymentHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles deployment events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        JOBS_TABLE_NAME: props?.jobsTableName || '',
      },
    });
  }
}
