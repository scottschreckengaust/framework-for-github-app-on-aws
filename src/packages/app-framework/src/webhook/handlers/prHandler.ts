import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface PRHandlerProps {
  readonly jobsTableName?: string;
}

export class PRHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: PRHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles pull_request events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        JOBS_TABLE_NAME: props?.jobsTableName || '',
      },
    });
  }
}
