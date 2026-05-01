import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface CheckRunHandlerProps {
  readonly jobsTableName?: string;
}

export class CheckRunHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: CheckRunHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles check_run events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        JOBS_TABLE_NAME: props?.jobsTableName || '',
      },
    });
  }
}
