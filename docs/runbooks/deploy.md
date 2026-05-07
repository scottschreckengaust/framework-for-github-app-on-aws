# Deploy Runbook

## CDK Deploy Context Values

The test stack requires three context values. These are NOT stored in code — they are passed at deploy time.

```bash
# From src/packages/app-framework-test-app/
AWS_PROFILE=burner1 npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=arn:aws:secretsmanager:us-east-1:001740294326:secret:ai3-mvp/webhook-secret-OYDnZI \
  --context gitHubClientId=Iv23li6ndiRoICMS3xab \
  --context oauthClientSecretArn=arn:aws:secretsmanager:us-east-1:001740294326:secret:ai3-mvp/oauth-client-secret-b9lCW7
```

### Where to find these values

| Context param | Source |
|---|---|
| `webhookSecretArn` | AWS Secrets Manager → `ai3-mvp/webhook-secret` |
| `gitHubClientId` | GitHub App settings → https://github.com/organizations/sbalswa/settings/apps/ai3-mvp → "Client ID" |
| `oauthClientSecretArn` | AWS Secrets Manager → `ai3-mvp/oauth-client-secret` |

### Common pitfall

The `gitHubClientId` can become stale if the GitHub App's OAuth credentials are regenerated. If users see a **404 on GitHub's OAuth page** after clicking the authorize link, the client ID needs updating from the App settings page.
