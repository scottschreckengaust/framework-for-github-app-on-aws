# Disaster Recovery and App Replication Runbook

## Scenario A: Recreate AWS Infrastructure from Scratch

If your AWS account is deleted or all resources are removed, here's how to recreate everything and reconnect to your existing GitHub App.

### What You Lose

| Component | Recoverable? | How |
|-----------|-------------|-----|
| Lambda functions | Yes | CDK redeploy |
| DynamoDB tables (Idempotency, AuthState, Jobs) | Yes | CDK redeploy (empty tables) |
| DynamoDB App Table | **Partially** | CDK creates it, but you must re-import the private key |
| DynamoDB Installation Table | Yes | CDK creates it, Installation Tracker refills it within 30 min |
| DynamoDB UserTokens Table | **No** | Users must re-authorize via OAuth |
| KMS keys (private key material) | **No** | Must generate a new GitHub private key and re-import |
| S3 payload archive | **No** | Historical webhook payloads are lost |
| Secrets Manager (webhook secret, OAuth client secret) | **No** | Must recreate |
| API Gateway endpoint URL | **Changes** | New URL, must update GitHub App webhook settings |

### Step-by-Step Recovery

#### 1. Prerequisites

```bash
# Verify AWS CLI access
AWS_PROFILE=<your-profile> aws sts get-caller-identity

# Verify Node.js, CDK, yarn
node --version   # >= 18
cdk --version
yarn --version
```

#### 2. Bootstrap CDK (if new account)

```bash
AWS_PROFILE=<profile> cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

#### 3. Install Dependencies and Build

```bash
cd framework-for-github-app-on-aws
yarn install
npx projen build
```

#### 4. Create Secrets in Secrets Manager

**Webhook secret:**
```bash
WEBHOOK_SECRET=$(openssl rand -hex 32)
AWS_PROFILE=<profile> aws secretsmanager create-secret \
  --name ai3-mvp/webhook-secret \
  --secret-string "$WEBHOOK_SECRET" \
  --region <REGION>
```
Note the ARN.

**OAuth client secret** (get from GitHub App settings, or generate new one):
```bash
AWS_PROFILE=<profile> aws secretsmanager create-secret \
  --name ai3-mvp/oauth-client-secret \
  --secret-string "<client-secret-from-github>" \
  --region <REGION>
```
Note the ARN.

#### 5. Deploy the Stack

```bash
cd src/packages/app-framework-test-app
AWS_PROFILE=<profile> npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<webhook-secret-arn> \
  --context gitHubClientId=<github-client-id> \
  --context oauthClientSecretArn=<oauth-client-secret-arn> \
  --outputs-file /tmp/cdk-output.json \
  --require-approval never
```

#### 6. Generate New GitHub App Private Key and Import

The old KMS key is gone. You need a new private key from GitHub:

1. Go to `github.com/organizations/<org>/settings/apps/<app-name>`
2. Scroll to **Private Keys** > **Generate a private key**
3. Save the `.pem` file

Import it:
```bash
cd src/packages/app-framework-ops-tools
AWS_PROFILE=<profile> AWS_REGION=<region> node lib/app-framework-cli.js \
  import-private-key /path/to/new-key.pem <APP_ID> <APP_TABLE_NAME>
```

Find the App Table name:
```bash
AWS_PROFILE=<profile> aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=CredentialManager,Values=AppTable \
  --resource-type-filters dynamodb:table \
  --region <REGION> \
  --query 'ResourceTagMappingList[0].ResourceARN' --output text
```

#### 7. Update GitHub App Settings

Go to `github.com/organizations/<org>/settings/apps/<app-name>`:

- **Webhook URL**: Set to the new API Gateway endpoint from `cdk-output.json` (`WebhookEndpoint` value)
- **Webhook secret**: Set to the value from Step 4
- **Callback URL**: Set to `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/auth/callback`

#### 8. Verify

**Test webhook:**
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST <webhook-endpoint>
# Should return 400 (missing headers) not 403 (WAF block)
```

**Test Credential Manager:**
Star/unstar a repo in the org. Check CloudWatch logs for the stub handler.

**Test OAuth:**
Run the device flow or visit the login URL in a browser.

#### 9. Users Must Re-Authorize

The UserTokens table is empty. Each user will need to click the OAuth authorization link again the next time they mention `@ai3-mvp`. The bot will prompt them automatically.

---

## Scenario B: Add Another Private App for a Different Org

The Credential Manager supports multiple GitHub Apps in a single deployment. Each app has its own App ID, private key (in KMS), and installations.

### What Stays the Same

- Same AWS infrastructure (Lambdas, DynamoDB, EventBridge, API Gateway)
- Same webhook endpoint URL
- Same OAuth callback URL
- Same S3 bucket, DLQ, CloudWatch alarms

### What's Different Per App

| Component | Per App |
|-----------|---------|
| GitHub App registration | New app on the new org |
| App ID | New numeric ID |
| Private key | New PEM, imported into new KMS key |
| Client ID | New OAuth client ID |
| Client Secret | New secret in Secrets Manager |
| Installations | Tracked separately in Installation Table |
| Webhook secret | Can share or use a separate one |

### Step-by-Step

#### 1. Register a New GitHub App

Go to `github.com/organizations/<new-org>/settings/apps/new`:

- **Name**: Choose a name (e.g., `ai3-mvp-<new-org>`)
- **Homepage URL**: Any valid URL
- **Webhook URL**: Use the SAME endpoint as your existing app: `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/webhook`
- **Webhook secret**: Use the SAME webhook secret value (from Secrets Manager) OR create a new one
- **Callback URL**: `https://<api-gateway-id>.execute-api.<region>.amazonaws.com/prod/auth/callback`
- **Permissions**: Match the first app (Contents: read, Issues: write, Pull requests: write, Members: read, Checks: write, etc.)
- **Events**: Subscribe to all
- **Where can this app be installed?**: Only on this account

Note the **App ID** and **Client ID**.

#### 2. Generate and Import Private Key

Generate a private key on the new app's settings page. Import it:

```bash
AWS_PROFILE=<profile> AWS_REGION=<region> node \
  src/packages/app-framework-ops-tools/lib/app-framework-cli.js \
  import-private-key /path/to/new-app-key.pem <NEW_APP_ID> <APP_TABLE_NAME>
```

The App Table now has two rows:

| AppId | KmsKeyArn |
|-------|-----------|
| <APP_ID> | arn:aws:kms:...:key/aaa |
| <new-id> | arn:aws:kms:...:key/bbb |

#### 3. Install the App on the New Org

Go to the new app's settings > **Install App** > select the org > choose repos.

The Installation Tracker will pick up the new installation within 30 minutes, or trigger a manual refresh:

```bash
# Using the Smithy client (from repo root):
AWS_PROFILE=<profile> node -e "
const { AppFrameworkClient, RefreshCachedDataCommand } = require('@aws/app-framework-for-github-apps-on-aws-client');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');
const client = new AppFrameworkClient({
  endpoint: '<RefreshCachedDataEndpoint>',
  region: '<region>',
  credentials: defaultProvider(),
  sha256: Sha256,
});
client.send(new RefreshCachedDataCommand({})).then(r => console.log(r.message));
"
```

#### 4. Generate OAuth Client Secret

On the new app's settings page, generate a client secret. Store it:

```bash
AWS_PROFILE=<profile> aws secretsmanager create-secret \
  --name ai3-mvp-<new-org>/oauth-client-secret \
  --secret-string "<new-client-secret>" \
  --region <REGION>
```

#### 5. Update CDK Deploy Context (if using separate OAuth config per app)

If the new app needs its own OAuth flow, you'll need to either:

**Option A: Share OAuth config** — Both apps use the same Client ID and secret. Users authorize once and the token works for both apps (if they have access to both orgs).

**Option B: Separate OAuth config** — Deploy a second WebhookIngestion construct with the new app's Client ID and secret. This creates separate OAuth routes. More complex but fully isolated.

For most cases, **Option A** works if both apps are owned by related orgs.

#### 6. Webhook Routing

The webhook receiver doesn't filter by App ID — it verifies the signature and dispatches ALL events to EventBridge. The handlers then use the `installation.id` and `appId` from the event payload to determine which app/org the event belongs to.

If you use SEPARATE webhook secrets per app, you'll need to update the receiver to try multiple secrets for signature verification. If you use the SAME webhook secret, no code changes needed.

#### 7. Verify

Comment `@ai3-mvp-<new-org> hello` on a PR in the new org. The comment handler will:
1. Get an installation token for the new app (via the new App ID in the event payload)
2. Check the user's org membership in the new org
3. Look up the user's OAuth token (shared across apps)
4. Reply

### Multiple Apps — Data Model

```
App Table (DynamoDB):
  AppId=<APP_ID> → KmsKeyArn=key/aaa (sbalswa)
  AppId=<new>   → KmsKeyArn=key/bbb (new-org)

Installation Table (DynamoDB):
  AppId=<APP_ID>, NodeId=O_kgDOD4tz5Q → sbalswa
  AppId=<new>,   NodeId=<new-node>   → new-org

UserTokens Table (DynamoDB):
  GitHubUserId=345885 → shared OAuth token (works for both orgs if user is member of both)
```

---

## Quick Reference: Key Values

| Item | Where to Find |
|------|--------------|
| App ID | GitHub App settings page (top) |
| Client ID | GitHub App settings page |
| App Table name | `aws resourcegroupstaggingapi get-resources --tag-filters Key=CredentialManager,Values=AppTable --resource-type-filters dynamodb:table` |
| Webhook endpoint | `cdk-output.json` → `WebhookEndpoint` |
| OAuth callback URL | `https://<api-gw-id>.execute-api.<region>.amazonaws.com/prod/auth/callback` |
| KMS key ARN | `aws dynamodb get-item --table-name <AppTable> --key '{"AppId":{"N":"<APP_ID>"}}'` |
| Installation Node ID | `aws dynamodb scan --table-name <InstallationTable> --filter-expression 'AppId = :a' --expression-attribute-values '{":a":{"N":"<APP_ID>"}}'` |
