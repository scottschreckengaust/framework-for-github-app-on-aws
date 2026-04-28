import {
  CredentialManager,
  WebhookIngestion,
} from '@aws/app-framework-for-github-apps-on-aws';
import { App, Stack, StackProps, CfnOutput, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
// CDK App entry for @aws/app-framework-for-github-apps-on-aws acceptance test.
// This stack is intended for testing @aws/app-framework-for-github-apps-on-aws library.
// In a real use case, it should be a stack defined by customer.
export class TheAppFrameworkTestStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);
    const credentialManager = new CredentialManager(
      this,
      'CredentialManager',
      {},
    );
    const appTokenUrl = credentialManager.appTokenEndpoint;
    const installationAccessTokenUrl =
      credentialManager.installationAccessTokenEndpoint;
    new CfnOutput(this, 'AppTokenEndpoint', {
      value: appTokenUrl,
      exportName: 'AppTokenEndpoint',
    });
    new CfnOutput(this, 'InstallationAccessTokenEndpoint', {
      value: installationAccessTokenUrl,
      exportName: 'InstallationAccessTokenEndpoint',
    });
    new CfnOutput(this, 'RefreshCachedDataEndpoint', {
      value: credentialManager.refreshCachedDataEndpoint,
      exportName: 'RefreshCachedDataEndpoint',
    });
    new CfnOutput(this, 'InstallationRecordEndpoint', {
      value: credentialManager.installationRecordEndpoint,
      exportName: 'InstallationRecordEndpoint',
    });
    new CfnOutput(this, 'InstallationsEndpoint', {
      value: credentialManager.installationsEndpoint,
      exportName: 'InstallationsEndpoint',
    });
    new CfnOutput(this, 'Region', {
      value: Aws.REGION,
      exportName: 'Region',
    });

    const webhookSecretArn = this.node.tryGetContext(
      'webhookSecretArn',
    ) as string;
    const alertEmail = this.node.tryGetContext('alertEmail') as string;
    const gitHubClientId = this.node.tryGetContext(
      'gitHubClientId',
    ) as string;
    const oauthClientSecretArn = this.node.tryGetContext(
      'oauthClientSecretArn',
    ) as string;
    if (webhookSecretArn) {
      const webhook = new WebhookIngestion(this, 'WebhookIngestion', {
        webhookSecretArn,
        alertEmail,
        gitHubClientId,
        oauthClientSecretArn,
      });
      new CfnOutput(this, 'WebhookEndpoint', {
        value: webhook.apiEndpoint,
        exportName: 'WebhookEndpoint',
      });
    }
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new TheAppFrameworkTestStack(app, 'the-app-framework-test-stack', {
  env: devEnv,
});

app.synth();
