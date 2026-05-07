# Quick Start

> **TL;DR:** Deploy a GitHub App bot that responds to commands on issues/PRs, authenticates users via OAuth, and runs CI checks via Step Functions — all serverless on AWS.

## Prerequisites

- AWS account with admin access + CLI configured
- Node.js >= 22, yarn, AWS CDK CLI
- A GitHub organization where you can create apps

## 5-Step Deploy

### 1. Register a GitHub App

Go to `github.com/organizations/<your-org>/settings/apps/new`:
- Name: your choice (e.g., `my-bot`)
- Webhook: leave disabled for now
- Permissions: Contents (read), Issues (write), Pull requests (write), Checks (write), Members (read)
- Install on: "Only on this account"
- Note: **App ID** (numeric, shown after creation)
- Generate a **private key** (.pem file)
- Enable **Device Flow** under OAuth settings

### 2. Build and Deploy

```bash
git clone <this-repo> && cd framework-for-github-app-on-aws
yarn install && yarn build

# Store secrets
WEBHOOK_SECRET=$(openssl rand -hex 32)
aws secretsmanager create-secret --name my-bot/webhook-secret --secret-string "$WEBHOOK_SECRET"
aws secretsmanager create-secret --name my-bot/oauth-client-secret --secret-string "<from-github-app-settings>"

# Bootstrap CDK (first time only)
cdk bootstrap

# Deploy
cd src/packages/app-framework-test-app
npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<webhook-secret-arn> \
  --context gitHubClientId=<client-id> \
  --context oauthClientSecretArn=<oauth-secret-arn> \
  --outputs-file /tmp/cdk-output.json
```

> **Security:** For production, replace `AdministratorAccess` on the CDK bootstrap execution role with a scoped policy. See `docs/DEPLOYMENT_PLAN_REFERENCE.md` Phase 1 for the minimal IAM policy.

### 3. Import Private Key

```bash
cd src/packages/app-framework-ops-tools
node lib/app-framework-cli.js import-private-key /path/to/key.pem <APP_ID> <APP_TABLE_NAME>
```

Find table name: `aws resourcegroupstaggingapi get-resources --tag-filters Key=CredentialManager,Values=AppTable --resource-type-filters dynamodb:table`

### 4. Configure Webhook

In GitHub App settings:
- **Webhook URL**: `<WebhookEndpoint from cdk-output.json>`
- **Webhook secret**: the value from step 2
- **Callback URL**: `https://<api-gw-id>.execute-api.<region>.amazonaws.com/prod/auth/callback`
- **Events**: subscribe to all
- Set **Active**: checked

### 5. Test

Comment on any issue/PR in your org:
```
@my-bot help
```

Bot replies with available commands. Done.

## What You Get

| Feature | How |
|---------|-----|
| Webhook ingestion | API Gateway + WAF + signature verification |
| Event routing | EventBridge custom bus → 8 handler Lambdas (comment, PR, push, check_run, deployment, discussion, stub, alert) |
| User auth | OAuth Device Flow + web redirect, auto-refresh |
| Bot commands | `help`, `echo`, `check` (extensible via command map) |
| CI checks | Step Functions Express workflow → GitHub Check Runs |
| Payload archive | S3 (90-day lifecycle) |
| Monitoring | CloudWatch dashboard, custom metrics, DLQ alarm |
| Health check | Scheduled Lambda every 15 min |
| Idempotency | Two layers (receiver + handler) |
| Token security | KMS encryption at rest + table-level encryption |

## Commands

| Command | What it does |
|---------|-------------|
| `@bot help` | List available commands |
| `@bot echo <text>` | Echo back text |
| `@bot check <sha>` | Run CI check (creates GitHub Check Run via Step Functions) |
| `@bot status` | Show running jobs (coming soon) |
| `@bot deploy <env>` | Deploy to environment (coming soon — Standard workflow) |
| `/bot <command>` | Same as @bot (slash command alternate) |

> **Workflows:** The `check` command uses an Express workflow (<5 min). Long-running Standard workflows for `deploy` and functional analysis are planned — see Issue #10 for status.

## Adding a New Command

1. Create `src/packages/app-framework/src/webhook/handlers/commands/mycommand.ts`
2. Export an `async function handleMyCommand(ctx: CommandContext): Promise<void>`
3. Register in `commands/index.ts`: `mycommand: handleMyCommand`
4. Update `commands/help.ts` with description
5. Deploy

## Key Files

```
src/packages/app-framework/src/webhook/
├── index.ts                    # Main CDK construct (WebhookIngestion)
├── receiver/                   # Webhook receiver Lambda
├── handlers/                   # Event handlers + command router
│   ├── commands/               # Bot commands (help, echo, check)
│   ├── commentHandler.*        # @bot mention handler
│   ├── prHandler.*             # pull_request events
│   └── ...                     # Other event handlers
├── auth/                       # OAuth login/callback + authorization
├── orchestration/              # Jobs table, reporting helpers
├── workflows/                  # Step Functions definitions
├── utils/                      # fetchWithRetry, metrics, idempotency
├── healthCheck.*               # Scheduled health check
└── alertHandler.*              # DLQ processor
```

## Cost & Budgeting

See `docs/DEPLOYMENT_PLAN_REFERENCE.md` Appendix D for detailed cost analysis across dev/staging/prod environments.

## Further Reading

- [Architecture Decisions](adr/) — why things are built the way they are
- [Deployment Plan Reference](docs/DEPLOYMENT_PLAN_REFERENCE.md) — cost model, IAM policies, multi-env setup
- [Runbooks](docs/runbooks/) — monitoring, auth, disaster recovery, redrive
