import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface DiscussionHandlerProps {
  readonly jobsTableName?: string;
}

export class DiscussionHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props?: DiscussionHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles discussion events',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        JOBS_TABLE_NAME: props?.jobsTableName || '',
      },
    });
  }
}
