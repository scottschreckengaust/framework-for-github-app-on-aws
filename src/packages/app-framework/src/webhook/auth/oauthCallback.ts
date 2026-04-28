import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface OAuthCallbackProps {
  readonly authStateTable: Table;
  readonly userTokensTable: Table;
  readonly gitHubClientId: string;
  readonly oauthClientSecret: ISecret;
  readonly oauthClientSecretArn: string;
  readonly tokenEncryptionKeyArn?: string;
}

export class OAuthCallback extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: OAuthCallbackProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles GitHub OAuth callback, exchanges code for token',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        AUTH_STATE_TABLE_NAME: props.authStateTable.tableName,
        USER_TOKENS_TABLE_NAME: props.userTokensTable.tableName,
        GITHUB_CLIENT_ID: props.gitHubClientId,
        OAUTH_CLIENT_SECRET_ARN: props.oauthClientSecretArn,
        ...(props.tokenEncryptionKeyArn && {
          TOKEN_ENCRYPTION_KEY_ARN: props.tokenEncryptionKeyArn,
        }),
      },
    });

    props.authStateTable.grantReadWriteData(this.lambdaHandler);
    props.userTokensTable.grantWriteData(this.lambdaHandler);
    props.oauthClientSecret.grantRead(this.lambdaHandler);
  }
}
