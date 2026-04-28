import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface CommentHandlerProps {
  readonly userTokensTableName: string;
  readonly orgName: string;
  readonly authLoginUrl: string;
  readonly oauthClientSecretArn: string;
  readonly gitHubClientId: string;
}

export class CommentHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: CommentHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles issue_comment events mentioning @ai3-mvp',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        USER_TOKENS_TABLE_NAME: props.userTokensTableName,
        ORG_NAME: props.orgName,
        AUTH_LOGIN_URL: props.authLoginUrl,
        OAUTH_CLIENT_SECRET_ARN: props.oauthClientSecretArn,
        GITHUB_CLIENT_ID: props.gitHubClientId,
      },
    });
  }
}
