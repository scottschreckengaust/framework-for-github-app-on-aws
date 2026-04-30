import { Aws, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  RestApi,
  MethodLoggingLevel,
} from 'aws-cdk-lib/aws-apigateway';
import {
  Alarm,
  AlarmWidget,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AttributeType, Table, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Key } from 'aws-cdk-lib/aws-kms';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { CfnWebACL, CfnWebACLAssociation } from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { AlertHandler } from './alertHandler';
import { OAuthCallback } from './auth/oauthCallback';
import { OAuthLogin } from './auth/oauthLogin';
import { CheckRunHandler } from './handlers/checkRunHandler';
import { CommentHandler } from './handlers/commentHandler';
import { DeploymentHandler } from './handlers/deploymentHandler';
import { DiscussionHandler } from './handlers/discussionHandler';
import { PRHandler } from './handlers/prHandler';
import { PushHandler } from './handlers/pushHandler';
import { StubHandler } from './handlers/stubHandler';
import { JobsTable } from './orchestration/jobsTable';
import { WebhookReceiver } from './receiver/webhookReceiver';

export interface WebhookIngestionProps {
  readonly webhookSecretArn: string;
  readonly alertEmail?: string;
  readonly gitHubClientId?: string;
  readonly oauthClientSecretArn?: string;
  readonly appId?: string;
  readonly nodeId?: string;
  readonly installationTokenFunctionName?: string;
  readonly installationTokenLambdaArn?: string;
}

export class WebhookIngestion extends Construct {
  readonly eventBus: EventBus;
  readonly apiEndpoint: string;
  readonly userTokensTable?: Table;
  readonly jobsTable?: Table;

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

    if (props.gitHubClientId && props.oauthClientSecretArn) {
      const oauthClientSecret = Secret.fromSecretCompleteArn(
        this,
        'OAuthClientSecret',
        props.oauthClientSecretArn,
      );

      const authStateTable = new Table(this, 'AuthStateTable', {
        partitionKey: { name: 'StateNonce', type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'TTL',
      });

      const tokenEncryptionKey = new Key(this, 'TokenEncryptionKey', {
        description: 'Encrypts OAuth tokens in UserTokens table',
        enableKeyRotation: true,
      });

      this.userTokensTable = new Table(this, 'UserTokensTable', {
        partitionKey: {
          name: 'GitHubUserId',
          type: AttributeType.NUMBER,
        },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: true,
        },
        encryptionKey: tokenEncryptionKey,
      });

      const callbackUrl = `https://${api.restApiId}.execute-api.${Aws.REGION}.amazonaws.com/prod/auth/callback`;

      const login = new OAuthLogin(this, 'OAuthLogin', {
        authStateTable,
        gitHubClientId: props.gitHubClientId,
        oauthCallbackUrl: callbackUrl,
      });

      const callback = new OAuthCallback(this, 'OAuthCallback', {
        authStateTable,
        userTokensTable: this.userTokensTable,
        gitHubClientId: props.gitHubClientId,
        oauthClientSecret,
        oauthClientSecretArn: props.oauthClientSecretArn,
        tokenEncryptionKeyArn: tokenEncryptionKey.keyArn,
      });

      tokenEncryptionKey.grantEncryptDecrypt(callback.lambdaHandler);

      const authResource = api.root.addResource('auth');
      authResource
        .addResource('login')
        .addMethod('GET', new LambdaIntegration(login.lambdaHandler));
      authResource
        .addResource('callback')
        .addMethod('GET', new LambdaIntegration(callback.lambdaHandler));
    }

    const jobs = new JobsTable(this, 'Jobs');
    this.jobsTable = jobs.table;

    const alert = new AlertHandler(this, 'Alert');

    const stub = new StubHandler(this, 'StubHandler');

    if (
      props.gitHubClientId &&
      props.oauthClientSecretArn &&
      this.userTokensTable
    ) {
      const authLoginUrl = `https://${api.restApiId}.execute-api.${Aws.REGION}.amazonaws.com/prod/auth/login`;
      const comment = new CommentHandler(this, 'CommentHandler', {
        userTokensTableName: this.userTokensTable.tableName,
        orgName: 'sbalswa',
        authLoginUrl,
        oauthClientSecretArn: props.oauthClientSecretArn,
        gitHubClientId: props.gitHubClientId,
        appId: props.appId || '',
        nodeId: props.nodeId || '',
        installationTokenFunctionName:
          props.installationTokenFunctionName || '',
        installationTokenLambdaArn: props.installationTokenLambdaArn || '',
        tokenEncryptionKeyArn: this.userTokensTable.encryptionKey?.keyArn,
      });

      this.userTokensTable.grantReadWriteData(comment.lambdaHandler);
      this.userTokensTable.encryptionKey?.grantEncryptDecrypt(
        comment.lambdaHandler,
      );
      const oauthSecret = Secret.fromSecretCompleteArn(
        this,
        'OAuthSecretForComment',
        props.oauthClientSecretArn,
      );
      oauthSecret.grantRead(comment.lambdaHandler);

      new Rule(this, 'IssueCommentRule', {
        eventBus: this.eventBus,
        eventPattern: {
          source: ['github'],
          detailType: ['issue_comment'],
        },
        targets: [
          new LambdaFunction(comment.lambdaHandler, {
            deadLetterQueue: alert.dlq,
          }),
        ],
      });

      new Rule(this, 'CommitCommentRule', {
        eventBus: this.eventBus,
        eventPattern: {
          source: ['github'],
          detailType: ['commit_comment'],
        },
        targets: [
          new LambdaFunction(comment.lambdaHandler, {
            deadLetterQueue: alert.dlq,
          }),
        ],
      });

      new Rule(this, 'PRReviewCommentRule', {
        eventBus: this.eventBus,
        eventPattern: {
          source: ['github'],
          detailType: ['pull_request_review_comment'],
        },
        targets: [
          new LambdaFunction(comment.lambdaHandler, {
            deadLetterQueue: alert.dlq,
          }),
        ],
      });
    }

    const prHandler = new PRHandler(this, 'PRHandler');
    new Rule(this, 'PullRequestRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['pull_request'],
      },
      targets: [
        new LambdaFunction(prHandler.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    const pushHandler = new PushHandler(this, 'PushHandler');
    new Rule(this, 'PushRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['push'],
      },
      targets: [
        new LambdaFunction(pushHandler.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    const checkRunHandler = new CheckRunHandler(this, 'CheckRunHandler');
    new Rule(this, 'CheckRunRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['check_run'],
      },
      targets: [
        new LambdaFunction(checkRunHandler.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    const deploymentHandler = new DeploymentHandler(this, 'DeploymentHandler');
    new Rule(this, 'DeploymentRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['deployment'],
      },
      targets: [
        new LambdaFunction(deploymentHandler.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    const discussionHandler = new DiscussionHandler(this, 'DiscussionHandler');
    new Rule(this, 'DiscussionRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: ['discussion'],
      },
      targets: [
        new LambdaFunction(discussionHandler.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    new Rule(this, 'AllEventsRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
      },
      targets: [
        new LambdaFunction(stub.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        }),
      ],
    });

    const oversizedAlarm = new Alarm(this, 'OversizedPayloadAlarm', {
      alarmName: 'ai3-mvp-webhook-oversized-payload',
      alarmDescription:
        'API Gateway returned 4XX — may indicate a payload exceeding the 10MB limit (413)',
      metric: new Metric({
        namespace: 'AWS/ApiGateway',
        metricName: '4XXError',
        dimensionsMap: {
          ApiName: 'ai3-mvp-webhook',
        },
        period: Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    const dlqAlarm = new Alarm(this, 'DLQDepthAlarm', {
      alarmName: 'ai3-mvp-dlq-not-empty',
      alarmDescription:
        'DLQ has messages - handler failures detected',
      metric: alert.dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    if (props.alertEmail) {
      const alertTopic = new Topic(this, 'AlertTopic', {
        topicName: 'ai3-mvp-webhook-alerts',
      });
      alertTopic.addSubscription(new EmailSubscription(props.alertEmail));
      oversizedAlarm.addAlarmAction(new SnsAction(alertTopic));
      dlqAlarm.addAlarmAction(new SnsAction(alertTopic));
    }

    const dashboard = new Dashboard(this, 'OperationsDashboard', {
      dashboardName: 'ai3-mvp-platform',
    });

    dashboard.addWidgets(
      new GraphWidget({
        title: 'Webhook Ingestion Rate',
        left: [receiver.lambdaHandler.metricInvocations({ period: Duration.minutes(5) })],
        width: 8,
        height: 6,
      }),
      new GraphWidget({
        title: 'Handler Errors',
        left: [
          receiver.lambdaHandler.metricErrors({ period: Duration.minutes(5), label: 'Receiver' }),
          stub.lambdaHandler.metricErrors({ period: Duration.minutes(5), label: 'Stub' }),
        ],
        width: 8,
        height: 6,
      }),
      new GraphWidget({
        title: 'DLQ Depth',
        left: [alert.dlq.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) })],
        width: 8,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new GraphWidget({
        title: 'API Gateway 4XX / 5XX',
        left: [
          new Metric({ namespace: 'AWS/ApiGateway', metricName: '4XXError', dimensionsMap: { ApiName: 'ai3-mvp-webhook' }, period: Duration.minutes(5), statistic: 'Sum', label: '4XX' }),
          new Metric({ namespace: 'AWS/ApiGateway', metricName: '5XXError', dimensionsMap: { ApiName: 'ai3-mvp-webhook' }, period: Duration.minutes(5), statistic: 'Sum', label: '5XX' }),
        ],
        width: 8,
        height: 6,
      }),
      new AlarmWidget({
        title: 'Alarm: Oversized Payload',
        alarm: oversizedAlarm,
        width: 8,
        height: 6,
      }),
      new AlarmWidget({
        title: 'Alarm: DLQ Not Empty',
        alarm: dlqAlarm,
        width: 8,
        height: 6,
      }),
    );

    Tags.of(this).add('ai3-mvp', 'WebhookIngestion');
  }
}
