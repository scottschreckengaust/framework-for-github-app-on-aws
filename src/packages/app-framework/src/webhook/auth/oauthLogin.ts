import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface OAuthLoginProps {
  readonly authStateTable: Table;
  readonly gitHubClientId: string;
  readonly oauthCallbackUrl: string;
}

export class OAuthLogin extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: OAuthLoginProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description:
        'Generates OAuth state and redirects to GitHub authorization',
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        AUTH_STATE_TABLE_NAME: props.authStateTable.tableName,
        GITHUB_CLIENT_ID: props.gitHubClientId,
        OAUTH_CALLBACK_URL: props.oauthCallbackUrl,
      },
    });

    props.authStateTable.grantWriteData(this.lambdaHandler);
  }
}
