# Deploy Runbook

## Prerequisites

- AWS credentials configured (check your profile with `aws sts get-caller-identity`)
- Node.js 22+, yarn installed
- `yarn build` passes

## CDK Deploy Context Values

The test stack requires three context values passed at deploy time. These values are environment-specific and MUST NOT be checked into source control.

### Using a .env file (recommended)

Copy the example file and fill in real values:

```bash
cp src/packages/app-framework-test-app/.env-example src/packages/app-framework-test-app/.env
# Edit .env with your values
```

Then deploy:

```bash
cd src/packages/app-framework-test-app
source .env
npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=$WEBHOOK_SECRET_ARN \
  --context gitHubClientId=$GITHUB_CLIENT_ID \
  --context oauthClientSecretArn=$OAUTH_CLIENT_SECRET_ARN
```

### Where to find context values

| Variable | Where to look |
|---|---|
| `WEBHOOK_SECRET_ARN` | AWS Secrets Manager — search for your app's webhook secret |
| `GITHUB_CLIENT_ID` | GitHub App settings page → "Client ID" field |
| `OAUTH_CLIENT_SECRET_ARN` | AWS Secrets Manager — search for your app's OAuth client secret |

### Common pitfall

The `GITHUB_CLIENT_ID` can become stale if the GitHub App's OAuth credentials are regenerated. If users see a **404 on GitHub's OAuth page** after clicking the authorize link, the client ID needs updating from the App settings page.

## Post-Deploy Verification

1. Confirm stack outputs show the webhook endpoint URL
2. Test the webhook endpoint: `curl -X POST <endpoint>/webhook` (should return `invalid_signature`)
3. Trigger a bot command in the installed org and verify response
