# App Framework Test App

CDK application that deploys the Credential Manager + WebhookIngestion for testing.

## Deploy

```bash
npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<WEBHOOK_SECRET_ARN> \
  --context gitHubClientId=<GITHUB_CLIENT_ID> \
  --context oauthClientSecretArn=<OAUTH_CLIENT_SECRET_ARN> \
  --outputs-file ./cdk-output.json
```

## What It Creates

- Credential Manager (NestedStack): App Token, Installation Token, Refresh, Installation Data, Installations endpoints
- WebhookIngestion: API Gateway + WAF, webhook receiver, EventBridge, 8 event handlers, OAuth login/callback, S3 payload archive, DynamoDB tables (Idempotency, UserTokens, AuthState, Jobs), CloudWatch dashboard + alarms, Step Functions CI Check workflow, health check scheduler

## Context Parameters

| Parameter              | Description                                         |
| ---------------------- | --------------------------------------------------- |
| `webhookSecretArn`     | Secrets Manager ARN for webhook HMAC secret         |
| `gitHubClientId`       | GitHub App OAuth Client ID                          |
| `oauthClientSecretArn` | Secrets Manager ARN for OAuth client secret         |
| `alertEmail`           | (Optional) Email for CloudWatch alarm notifications |
