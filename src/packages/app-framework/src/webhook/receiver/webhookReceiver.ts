import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';
import { WebhookEnvironmentVariables } from '../constants';

export interface WebhookReceiverProps {
  readonly webhookSecret: ISecret;
  readonly webhookSecretArn: string;
  readonly eventBus: EventBus;
  readonly idempotencyTable: Table;
}

export class WebhookReceiver extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebhookReceiverProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description:
        'Receives GitHub webhooks, verifies signatures, dispatches to EventBridge',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        [WebhookEnvironmentVariables.WEBHOOK_SECRET_ARN]:
          props.webhookSecretArn,
        [WebhookEnvironmentVariables.EVENT_BUS_NAME]:
          props.eventBus.eventBusName,
        [WebhookEnvironmentVariables.IDEMPOTENCY_TABLE_NAME]:
          props.idempotencyTable.tableName,
      },
    });

    props.webhookSecret.grantRead(this.lambdaHandler);
    props.idempotencyTable.grantWriteData(this.lambdaHandler);
    props.eventBus.grantPutEventsTo(this.lambdaHandler);
  }
}
