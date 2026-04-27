import { Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  RestApi,
  MethodLoggingLevel,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { StubHandler } from './handlers/stubHandler';
import { WebhookReceiver } from './receiver/webhookReceiver';

export interface WebhookIngestionProps {
  readonly webhookSecretArn: string;
}

export class WebhookIngestion extends Construct {
  readonly eventBus: EventBus;
  readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: WebhookIngestionProps) {
    super(scope, id);

    const webhookSecret = Secret.fromSecretCompleteArn(
      this,
      'WebhookSecret',
      props.webhookSecretArn,
    );

    this.eventBus = new EventBus(this, 'GitHubEventBus', {
      eventBusName: 'ai3-mvp-github-events',
    });

    const idempotencyTable = new Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'DeliveryId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
    });

    const payloadBucket = new Bucket(this, 'PayloadBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(90), prefix: 'webhooks/' }],
    });

    const receiver = new WebhookReceiver(this, 'Receiver', {
      webhookSecret,
      webhookSecretArn: props.webhookSecretArn,
      eventBus: this.eventBus,
      idempotencyTable,
      payloadBucket,
    });

    const api = new RestApi(this, 'WebhookApi', {
      restApiName: 'ai3-mvp-webhook',
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const webhookResource = api.root.addResource('webhook');
    webhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiver.lambdaHandler),
    );

    this.apiEndpoint = api.urlForPath('/webhook');

    const webAcl = new CfnWebACL(this, 'WebhookWAF', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'ai3-mvp-webhook-waf',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'ai3-mvp-webhook-ratelimit',
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'ai3-mvp-webhook-common-rules',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              excludedRules: [
                { name: 'GenericLFI_BODY' },
                { name: 'GenericRFI_BODY' },
                { name: 'SizeRestrictions_BODY' },
                { name: 'CrossSiteScripting_BODY' },
                { name: 'EC2MetaDataSSRF_BODY' },
                { name: 'RestrictedExtensions_URIPATH' },
              ],
            },
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'WebhookWAFAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });

    const stub = new StubHandler(this, 'StubHandler');

    new Rule(this, 'AllEventsRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
      },
      targets: [new LambdaFunction(stub.lambdaHandler)],
    });

    Tags.of(this).add('ai3-mvp', 'WebhookIngestion');
  }
}
