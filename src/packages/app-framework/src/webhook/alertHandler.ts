import { Duration } from 'aws-cdk-lib';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../lambdaDefaults';

export class AlertHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
    });

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Processes failed events from DLQ',
      memorySize: 256,
      timeout: Duration.seconds(30),
    });

    this.lambdaHandler.addEventSource(
      new SqsEventSource(this.dlq, { batchSize: 10 }),
    );
  }
}
