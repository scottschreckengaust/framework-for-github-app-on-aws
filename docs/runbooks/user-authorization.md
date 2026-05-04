# User Authorization Runbook

## Overview

Users must authorize the GitHub App before the bot can act on their behalf. Authorization creates a user-to-server OAuth token (`ghu_`) that is stored encrypted in the UserTokens DynamoDB table.

## How Users Authorize

### Via GitHub Comment (Production Flow)

When a user mentions `@ai3-mvp` or `/ai3-mvp` on an issue/PR and hasn't authorized yet, the bot replies with an authorization link. The user clicks the link, authorizes on GitHub, and the callback Lambda stores the token.

### Via Device Flow CLI (Admin/Testing)

For headless environments (SSH, tmux) or initial setup:

```bash
cd src/packages/app-framework-ops-tools

npx ts-node src/app-framework-cli.ts device-flow-auth \
  --client-id <GITHUB_CLIENT_ID> \
  --user-tokens-table <USER_TOKENS_TABLE_NAME> \
  --kms-key-arn <TOKEN_ENCRYPTION_KEY_ARN>
```

The command will display a URL and code. Open the URL in any browser, enter the code, and authorize.

#### Finding the Required Values

**Client ID** — From the GitHub App settings page:
```
github.com/organizations/<org>/settings/apps/<app-name>
```

**UserTokens table name:**
```bash
AWS_PROFILE=<profile> aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=ai3-mvp,Values=WebhookIngestion \
  --resource-type-filters dynamodb:table \
  --region us-east-1 \
  --query 'ResourceTagMappingList[*].ResourceARN' --output text \
  | tr '\t' '\n' | grep UserTokens | sed 's|.*/||'
```

**KMS key ARN** (for token encryption):
```bash
AWS_PROFILE=<profile> aws kms list-keys --region us-east-1 \
  --query 'Keys[*].KeyId' --output text | tr '\t' '\n' | \
  while read k; do
    AWS_PROFILE=<profile> aws kms describe-key --key-id "$k" \
      --region us-east-1 \
      --query 'KeyMetadata.{Id:KeyId,Desc:Description}' \
      --output text 2>/dev/null
  done | grep -i token
```

#### Example (replace with your values)

```bash
AWS_PROFILE=<profile> npx ts-node src/app-framework-cli.ts device-flow-auth \
  --client-id <GITHUB_CLIENT_ID> \
  --user-tokens-table <USER_TOKENS_TABLE> \
  --kms-key-arn <TOKEN_ENCRYPTION_KEY_ARN>
```

## Token Lifecycle

| Token | Lifetime | Auto-Refresh |
|-------|----------|-------------|
| Access token (`ghu_`) | 8 hours | Yes — authorizeUser module refreshes automatically |
| Refresh token (`ghr_`) | 6 months (rotated on each use) | Automatic when access token expires |

## When Re-Authorization is Needed

- First time a user interacts with the bot
- Refresh token expires (6 months of inactivity)
- User revokes the app (GitHub Settings → Applications → Revoke)
- KMS key is rotated or deleted (existing encrypted tokens can't be decrypted)
- DynamoDB UserTokens table is recreated (disaster recovery)

## Verifying a User's Token

```bash
AWS_PROFILE=<profile> aws dynamodb get-item \
  --table-name <USER_TOKENS_TABLE> \
  --key '{"GitHubUserId":{"N":"<USER_ID>"}}' \
  --region us-east-1 \
  --query 'Item.{Login:Login.S,Expiry:TokenExpiry.S,LastUsed:LastUsed.S}'
```

## Revoking a User's Token

Delete from DynamoDB (the user will be prompted to re-authorize next time):

```bash
AWS_PROFILE=<profile> aws dynamodb delete-item \
  --table-name <USER_TOKENS_TABLE> \
  --key '{"GitHubUserId":{"N":"<USER_ID>"}}' \
  --region us-east-1
```

The user can also revoke from GitHub: Settings → Applications → Authorized GitHub Apps → ai3-mvp → Revoke.
