# Deployment Plan: "my-github-app" on AWS

## Architecture Overview

This framework deploys a **Credential Manager** as a CDK NestedStack containing:

- 2 DynamoDB tables (App table, Installation table)
- 5 Lambda functions with IAM-authenticated Function URLs
- 2 EventBridge scheduled rules (installation sync every 30 min, rate-limit tracking every 10 min)
- KMS keys (created at key-import time, not at deploy time)
- CloudWatch dashboard + alarm (optional, for rate-limit monitoring)

All Lambda Function URLs require **AWS IAM SigV4 authentication**. KMS signing is restricted via **tag-based conditions**. Access to each endpoint is granted individually per IAM principal. This is a strong least-privilege design out of the box.

---

## Prerequisites

### P1. AWS Account & CLI Setup

1. Ensure you have an AWS account with administrator privileges (you'll scope down after initial setup).
2. Install and configure the AWS CLI v2:

   ```sh
   aws configure
   # Set your region (e.g., us-east-1), access key, secret key
   ```

3. Verify access:

   ```sh
   aws sts get-caller-identity
   ```

### P2. Node.js

1. Install Node.js **v18 or higher** (required by all packages — enforced in `package.json` via `engines.node: ">18.0.0"`).

   ```sh
   node --version   # Must be >= 18
   ```

### P3. AWS CDK CLI

1. Install the AWS CDK CLI globally:

   ```sh
   npm install -g aws-cdk
   ```

2. Verify:

   ```sh
   cdk --version
   ```

### P4. GitHub App Registration

1. Go to **GitHub → Settings → Developer Settings → GitHub Apps → New GitHub App**.
2. Configure your app:
   - **Name**: `my-github-app` (or your preferred name)
   - **Homepage URL**: any valid URL
   - **Webhook**: disable if not needed, or configure as needed
   - **Permissions**: grant only the minimum permissions your app needs (e.g., `contents: read`, `pull_requests: write`). This is critical for least privilege — the framework's `scopeDown` feature can further restrict tokens at runtime, but the app registration sets the ceiling.
   - **Where can this app be installed?**: Choose **"Only on this account"** (private app) unless you explicitly need public installation. Per the `RISK_PROFILE.md`, private apps retain control over where your app can be installed and who can install it.
3. After creation, note your **App ID** (numeric, shown at top of app settings page).
4. **Generate a private key**:
   - Scroll to "Private Keys" section → click **"Generate a private key"**
   - A `.pem` file downloads automatically
   - **Store this file securely** — it cannot be re-downloaded. You'll need the file path for Step 5.
5. **Install the app** on your target organization or user account:
   - Go to your app's settings → "Install App" → select the account/org
   - Note the **Node ID** of the installation target (you'll need this for API calls later)

> **Security note**: GitHub Apps are limited to 25 active private keys per application. The framework deletes the local PEM file after successful import into KMS.

---

## Phase 1: Create a Least-Privilege IAM Deployment Role

Before deploying anything, create a scoped-down IAM role for CDK deployment instead of using your admin credentials directly.

### Step 1: Bootstrap CDK with Least-Privilege Policies

```sh
cdk bootstrap aws://<ACCOUNT_ID>/<REGION> \
  --cloudformation-execution-policies "arn:aws:iam::aws:policy/AdministratorAccess"
```

> **Security hardening**: After your first successful deploy, replace `AdministratorAccess` with a custom policy scoped to only the resources CDK creates. The framework creates: DynamoDB tables, Lambda functions, Lambda Function URLs, EventBridge rules, IAM roles, CloudWatch dashboards/alarms. A tighter policy would include:
>
> - `dynamodb:CreateTable`, `dynamodb:DeleteTable`, `dynamodb:DescribeTable`, `dynamodb:TagResource`
> - `lambda:CreateFunction`, `lambda:DeleteFunction`, `lambda:AddPermission`, `lambda:CreateFunctionUrlConfig`, `lambda:TagResource`
> - `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PutRolePolicy`, `iam:PassRole`, `iam:DeleteRole`
> - `events:PutRule`, `events:PutTargets`, `events:DeleteRule`
> - `cloudwatch:PutDashboard`, `cloudwatch:PutMetricAlarm`
> - `cloudformation:*` (for CDK stacks)
> - `kms:CreateKey`, `kms:TagResource`, `kms:DescribeKey` (for ops-tools later)

### Step 2: Create a Dedicated Operator IAM Policy for Ops-Tools

Create an IAM policy for the human operator who will run the key-import CLI. This is separate from the CDK deployment role. Based on the ops-tools README, the minimum permissions are:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TaggingAPI",
      "Effect": "Allow",
      "Action": "tag:GetResources",
      "Resource": "*"
    },
    {
      "Sid": "KMSKeyManagement",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:DescribeKey",
        "kms:GetParametersForImport",
        "kms:ImportKeyMaterial",
        "kms:Sign",
        "kms:TagResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBTableAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:GetItem"
      ],
      "Resource": "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/*"
    }
  ]
}
```

> **Security hardening**: After deployment, narrow the DynamoDB resource ARN to the specific App table ARN. Narrow the KMS resource to keys tagged with `FrameworkForGitHubAppOnAwsManaged: true`.

---

## Phase 2: Build the Framework

### Step 3: Install Dependencies

From the repository root:

```sh
yarn install
```

### Step 4: Build All Packages

The project uses Lerna for monorepo management. Build everything:

```sh
npx projen build
```

This runs:

1. Lerna builds all sub-packages in dependency order (Smithy codegen → app-framework → ops-tools → test-app)
2. Compiles TypeScript
3. Runs unit tests
4. Runs ESLint

> **What gets built**: The Smithy models in `src/packages/smithy/` generate both a server SDK (`@aws/app-framework-for-github-apps-on-aws-ssdk`) and a client SDK (`@aws/app-framework-for-github-apps-on-aws-client`). The app-framework package bundles these into Lambda functions. The ops-tools package builds the CLI for key import.

---

## Phase 3: Create Your CDK Application Stack

### Step 5: Create Your Application Stack

Create a new file for your app's CDK stack. Model it after the test app in `src/packages/app-framework-test-app/src/main.ts`:

```typescript
// src/packages/my-github-app/src/main.ts
import { CredentialManager } from '@aws/app-framework-for-github-apps-on-aws';
import { App, Stack, StackProps, CfnOutput, Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class MyGitHubAppStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    // Deploy the Credential Manager (NestedStack)
    const credentialManager = new CredentialManager(this, 'CredentialManager', {});

    // Output the endpoints you'll need
    new CfnOutput(this, 'AppTokenEndpoint', {
      value: credentialManager.appTokenEndpoint,
      exportName: 'MyGitHubApp-AppTokenEndpoint',
    });
    new CfnOutput(this, 'InstallationAccessTokenEndpoint', {
      value: credentialManager.installationAccessTokenEndpoint,
      exportName: 'MyGitHubApp-InstallationAccessTokenEndpoint',
    });
    new CfnOutput(this, 'RefreshCachedDataEndpoint', {
      value: credentialManager.refreshCachedDataEndpoint,
      exportName: 'MyGitHubApp-RefreshCachedDataEndpoint',
    });
    new CfnOutput(this, 'InstallationRecordEndpoint', {
      value: credentialManager.installationRecordEndpoint,
      exportName: 'MyGitHubApp-InstallationRecordEndpoint',
    });
    new CfnOutput(this, 'InstallationsEndpoint', {
      value: credentialManager.installationsEndpoint,
      exportName: 'MyGitHubApp-InstallationsEndpoint',
    });
    new CfnOutput(this, 'Region', {
      value: Aws.REGION,
      exportName: 'MyGitHubApp-Region',
    });

    // Optional: Enable rate-limit monitoring dashboard
    credentialManager.rateLimitDashboard({ limit: 20 });

    // When you add your own Lambda functions that need GitHub tokens:
    // credentialManager.grantGetAppToken(myLambdaFunction);
    // credentialManager.grantGetInstallationAccessToken(myLambdaFunction);
    // credentialManager.grantRefreshCachedData(myLambdaFunction);
    // credentialManager.grantGetInstallationRecord(myLambdaFunction);
    // credentialManager.grantGetInstallations(myLambdaFunction);
  }
}

const app = new App();
new MyGitHubAppStack(app, 'my-github-app-stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
app.synth();
```

> **Renaming later**: The app name "my-github-app" only appears in your stack ID and CfnOutput export names. To rename, change the stack ID string and export names. The framework itself uses tags (not names) for resource identification, so renaming is straightforward.

---

## Phase 4: Deploy Infrastructure

### Step 6: Synthesize and Review the CloudFormation Template

```sh
cdk synth my-github-app-stack
```

Review the generated template in `cdk.out/` to verify:

- All Lambda functions use `FunctionUrlAuthType: AWS_IAM` (no public endpoints)
- KMS policies use tag-based conditions (`FrameworkForGitHubAppOnAwsManaged: true` AND `Status: Active`)
- DynamoDB tables have Point-in-Time Recovery enabled
- App table has `RETAIN` removal policy (won't be deleted if stack is destroyed)
- Lambda runtime is Node.js 22.x with X-Ray tracing active
- No overly broad IAM policies

### Step 7: Deploy

```sh
cdk deploy my-github-app-stack --outputs-file ./cdk-output.json
```

This creates the following resources in your AWS account:

- **NestedStack** tagged `FrameworkForGitHubAppOnAwsManaged: CredentialManager`
- **App Table** (DynamoDB) — tagged `CredentialManager: AppTable`, RETAIN removal policy
- **Installation Table** (DynamoDB) — tagged `CredentialManager: AppInstallationTable`, with GSIs for NodeID and InstallationID lookups
- **5 Lambda Functions** with Function URLs:
  1. App Token Generator (512 MB, 60s timeout)
  2. Installation Access Token Generator (512 MB, 60s timeout)
  3. Refresh Cached Data (1024 MB, 5 min timeout)
  4. Get Installation Data (512 MB, 1 min timeout)
  5. Get Installations (512 MB, 1 min timeout)
- **Installation Tracker** Lambda (1024 MB, 5 min timeout) — triggered every 30 minutes by EventBridge
- **Rate Limit Tracker** Lambda (1024 MB, 5 min timeout) — triggered every 10 minutes by EventBridge
- **CloudWatch Dashboard** with rate-limit alarm (if you included `rateLimitDashboard`)

Save the `cdk-output.json` — it contains your Function URL endpoints.

---

## Phase 5: Import GitHub App Private Key into KMS

### Step 8: Install the Ops-Tools CLI

```sh
npm install -g @aws/app-framework-for-github-apps-on-aws-ops-tools
```

Or run locally from the repo:

```sh
cd src/packages/app-framework-ops-tools
npx projen build
```

### Step 9: Identify Your DynamoDB App Table

```sh
app-framework-for-github-apps-on-aws-ops-tools get-table-name
```

This queries the Resource Groups Tagging API for DynamoDB tables tagged with `FrameworkForGitHubAppOnAwsManaged: CredentialManager` and `CredentialManager: AppTable`. Note the table name from the output.

### Step 10: Import the Private Key

```sh
app-framework-for-github-apps-on-aws-ops-tools import-private-key \
  /path/to/your-private-key.pem \
  <YOUR_GITHUB_APP_ID> \
  <TABLE_NAME_FROM_STEP_9>
```

**What this does** (from `importPrivateKey.ts`):

1. **Validates** the PEM file exists, signs a test JWT with it, authenticates against GitHub API to confirm the App ID matches, and verifies the table name exists
2. **Converts** the PEM from PKCS#1 to PKCS#8 DER format (GitHub generates PKCS#1; KMS requires PKCS#8)
3. **Creates a new KMS key** with `Origin: EXTERNAL`, `KeySpec: RSA_2048`, `KeyUsage: SIGN_VERIFY`, tagged as `Status: Active`, `FrameworkForGitHubAppOnAwsManaged: true`
4. **Retrieves KMS import parameters** (wrapping public key + import token) using `RSA_AES_KEY_WRAP_SHA_256`
5. **Encrypts** the private key using AES-256 key wrap with padding (RFC 5649), then wraps the AES key with the KMS public key
6. **Imports** the encrypted key material into KMS with `KEY_MATERIAL_DOES_NOT_EXPIRE`
7. **Validates** by signing a JWT with the imported KMS key and authenticating against GitHub API
8. **Updates DynamoDB** App table with `{AppId, KmsKeyArn}`
9. If this is a key rotation, **tags the old KMS key as `Inactive`**
10. **Permanently deletes the PEM file** from your local filesystem

> **Security note**: After this step, the private key exists ONLY inside KMS HSMs. It never leaves the secure boundary. All signing operations go through KMS. This is the core security property of the framework.

> **If import fails**: The CLI tags the created KMS key as `Status: Failed`. Check the AWS KMS console and schedule failed keys for deletion to avoid ongoing costs.

---

## Phase 6: Verify the Deployment

### Step 11: Verify Installation Sync

Wait up to 30 minutes for the Installation Tracker scheduler to run, or trigger a manual refresh using the Smithy client:

```typescript
import { AppFrameworkClient, RefreshCachedDataCommand } from '@aws/app-framework-for-github-apps-on-aws-client';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const client = new AppFrameworkClient({
  endpoint: '<RefreshCachedDataEndpoint from cdk-output.json>',
  region: '<your-region>',
  credentials: defaultProvider(),
  sha256: Sha256,
});

const response = await client.send(new RefreshCachedDataCommand({}));
console.log(response.message, response.refreshedDate);
```

> **Note**: The caller must have `lambda:InvokeFunctionUrl` permission on the specific Lambda ARN with condition `lambda:FunctionUrlAuthType: AWS_IAM`. Use the `grantRefreshCachedData()` method in your CDK stack to grant this.

### Step 12: Test Token Generation

```typescript
import { GetAppTokenCommand } from '@aws/app-framework-for-github-apps-on-aws-client';

const appTokenResponse = await client.send(new GetAppTokenCommand({
  appId: <YOUR_GITHUB_APP_ID>,
}));
console.log('App Token expires:', appTokenResponse.expirationTime);
// Token is an 8-minute JWT (conservative vs GitHub's 10-min max)
```

```typescript
import { GetInstallationTokenCommand } from '@aws/app-framework-for-github-apps-on-aws-client';

const installationTokenResponse = await client.send(new GetInstallationTokenCommand({
  appId: <YOUR_GITHUB_APP_ID>,
  nodeId: '<your-installation-target-node-id>',
  // Optional: scope down to minimum needed permissions
  scopeDown: {
    repositoryNames: ['specific-repo'],
    permissions: { contents: 'read' },
  },
}));
console.log('Installation Token expires:', installationTokenResponse.expirationTime);
```

---

## Phase 7: Security Hardening Checklist

Given your priority on minimizing attack surface, verify each of these:

### Access Control

- [ ] **All Function URLs use IAM auth** — verified in CDK code: `authType: FunctionUrlAuthType.AWS_IAM` on every endpoint
- [ ] **KMS signing restricted by tags** — only keys tagged `FrameworkForGitHubAppOnAwsManaged: true` AND `Status: Active` can be used for signing
- [ ] **Each grant method is per-principal** — `grantGetAppToken()`, `grantGetInstallationAccessToken()`, etc. each grant `lambda:InvokeFunctionUrl` on only that specific Lambda ARN with `FunctionUrlAuthType: AWS_IAM` condition
- [ ] **GitHub App is private** — set to "Only on this account" in GitHub settings (per `RISK_PROFILE.md` recommendation)
- [ ] **Use `scopeDown`** on every `GetInstallationTokenCommand` call to request only the permissions and repositories you actually need

### Data Protection

- [ ] **Private key never leaves KMS HSMs** — all signing is via `kms:Sign` API calls
- [ ] **PEM file deleted after import** — the CLI `unlinkSync`s the file after successful import
- [ ] **DynamoDB Point-in-Time Recovery** enabled on both tables
- [ ] **App table has RETAIN removal policy** — survives stack deletion

### Network

- [ ] **Lambda Function URL CORS** — currently set to `allowedOrigins: ['*']`. If your app only calls from specific origins, tighten this in the CDK construct
- [ ] **GitHub API base URL** — defaults to `https://api.github.com` but can be overridden via `GITHUB_API_URL` environment variable (for GitHub Enterprise)

### Monitoring

- [ ] **X-Ray tracing** is active on all Lambdas (`Tracing.ACTIVE`)
- [ ] **Rate-limit dashboard** monitors API usage per installation
- [ ] **Rate-limit alarm** fires when any installation drops below 20% remaining calls
- [ ] **All token operations are logged** with caller ARN, hashed token (SHA-256), and expiration time — never the raw token

### Operational

- [ ] **Narrow the CDK bootstrap execution policy** after first deploy (replace `AdministratorAccess`)
- [ ] **Narrow the operator IAM policy** DynamoDB resource ARN to the specific App table
- [ ] **Schedule old KMS keys for deletion** after key rotation (the framework tags them `Inactive` but does NOT auto-delete)
- [ ] **Monitor KMS key costs** — each key incurs storage fees; failed imports create keys tagged `Status: Failed` that should be cleaned up

---

## Phase 8: Ongoing Operations

### Key Rotation

1. Generate a new private key in GitHub App settings
2. Re-run `import-private-key` with the new PEM file — the tool automatically tags the old key as `Inactive` and updates DynamoDB
3. After confirming all processes work with the new key:
   - Delete the old private key from GitHub App settings
   - Schedule the old KMS key for deletion in AWS KMS console (7–30 day waiting period)

### Renaming the App

To rename from "my-github-app" to something else:

1. Update the stack ID in your CDK app (`my-github-app-stack` → new name)
2. Update `CfnOutput` export names
3. Redeploy — the framework uses tags, not names, for resource identification, so the underlying resources don't need renaming

### Cost Awareness

- **DynamoDB**: Pay-per-request billing, PITR costs, storage
- **Lambda**: Invocation + memory + Function URL request charges
- **KMS**: Key storage ($1/month/key) + signing operations ($0.03/10K requests)
- **App table RETAIN policy**: persists after stack deletion — delete manually if no longer needed
- **Old KMS keys**: schedule for deletion after rotation to stop storage charges

### Cleanup (if needed)

```sh
cdk destroy my-github-app-stack
```

This removes everything **except** the App DynamoDB table (RETAIN policy). Manually delete:

- The retained App table
- Any KMS keys (schedule for deletion in console)
- The CDK bootstrap stack if no longer needed

---

## Appendix A: Public vs Private GitHub Apps

### What "Private" Means

**Private** means: only the GitHub account (user or org) that *owns* the app can install it. Nobody else can see it or install it. There's no marketplace listing, no discovery page.

**Public** means: *anyone* on GitHub can find and install your app on their own account/org. It shows up at `github.com/apps/your-app-name`, and optionally in the GitHub Marketplace.

### Why Private Is Recommended

The `RISK_PROFILE.md` in this repo says it plainly: if you don't intend your app for public use, private is better because you retain control over **where** it gets installed and **who** installs it. Every installation gets access to the repositories/permissions you configured — so a public app means strangers can grant your app access to *their* repos, and your infrastructure (the Lambda functions, KMS keys, DynamoDB tables) would be servicing those installations too.

For an internal tool, private is the right choice. It shrinks the attack surface because:

- No one outside your org can install it
- You control exactly which repos/orgs it touches
- Your credential manager only handles installations you explicitly created

### How End Users Interact

**Internal tool (most likely)**: You install the app on your org(s) yourself. Team members don't interact with the GitHub App directly — they interact with whatever automation you build on top of it (CI/CD pipelines, bots, etc.) that calls the Credential Manager APIs behind the scenes.

**Multiple orgs you own**: You can install a private app on any org/account owned by the same owner. If you need it across orgs with *different* owners, you'd either make it public (and accept the broader exposure), or create multiple private apps (one per org owner) — the framework supports managing multiple App IDs in a single Credential Manager deployment.

**External users**: Make it public. Users find it via `github.com/apps/your-app-name` or the Marketplace. They click "Install" and choose which repos to grant access to. There's no invite mechanism — it's self-service.

---

## Appendix B: Multiple Private Apps (One Per Org Owner)

### Same Code, Different Registrations

Yes, it's the **same codebase and same AWS infrastructure**. The difference is purely at the GitHub registration level.

Each GitHub App registration is a separate entity on GitHub with its own:

- App ID (numeric)
- Private signing key
- Permissions configuration
- Owner (the user or org that created it)

But they all feed into the **same single Credential Manager deployment** on AWS. The framework was explicitly designed for this — look at how the data model works:

- **App Table** (DynamoDB): `AppId (partition key) → KmsKeyArn` — one row per app
- **Installation Table**: `AppId + NodeId → InstallationId` — tracks installations across all apps

When the Installation Tracker scheduler runs every 30 minutes, it iterates over *every* AppId in the App Table, fetches an App Token for each, then queries GitHub for that app's installations. The rate-limit tracker does the same — it monitors rate limits per installation across all apps.

### Concrete Example

Say you have three orgs: `acme-core`, `acme-platform`, `acme-data`. Each has a different owner. You'd:

1. Register three private GitHub Apps on GitHub (one owned by each org)
2. Deploy **one** Credential Manager stack on AWS
3. Run `import-private-key` three times — once per app, each with its own PEM file and App ID
4. Install each app on its respective org

Your App Table ends up with:

| AppId  | KmsKeyArn                          |
|--------|------------------------------------|
| 111111 | arn:aws:kms:...:key/aaa-aaa        |
| 222222 | arn:aws:kms:...:key/bbb-bbb        |
| 333333 | arn:aws:kms:...:key/ccc-ccc        |

Your business logic then calls the appropriate endpoint with the right `appId` and `nodeId`:

```typescript
// Get a token for acme-core
const coreToken = await client.send(new GetInstallationTokenCommand({
  appId: 111111,
  nodeId: '<acme-core-node-id>',
}));

// Get a token for acme-data
const dataToken = await client.send(new GetInstallationTokenCommand({
  appId: 333333,
  nodeId: '<acme-data-node-id>',
}));
```

The permissions can differ per app too. Maybe `acme-core` app has `contents: write` while `acme-data` app only has `contents: read`. Each app registration has its own permission set on GitHub.

### What Stays the Same vs What Differs

| Aspect | Same across all apps | Different per app |
|--------|---------------------|-------------------|
| AWS infrastructure (Lambdas, DynamoDB, KMS) | ✅ | |
| CDK stack / deployment | ✅ | |
| Smithy client code | ✅ | |
| GitHub App ID | | ✅ |
| Private signing key (in KMS) | | ✅ |
| Permissions granted | | ✅ |
| Owner org/user | | ✅ |
| Installations | | ✅ |

---

## Appendix C: Transitioning to Public — The Hybrid Scenario

### Option A: Convert One App to Public, Keep the Rest Private

GitHub lets you change an existing app from private to public in the app settings. So you could:

1. Pick one of your three apps (say the `acme-platform` one)
2. Change it to public in GitHub settings
3. Now anyone can install that app on their repos
4. The other two remain private, only installable by their respective owners

This works fine with the Credential Manager — it doesn't care whether an app is public or private. It just sees App IDs and installations. When external users install your now-public app, the Installation Tracker picks up those new installations automatically on its next 30-minute cycle (or you trigger a manual refresh).

**But here's the security concern**: your single AWS infrastructure is now serving both trusted (your private apps) and untrusted (random external users of the public app) installations. Every external installation:

- Consumes your GitHub API rate limits
- Generates tokens through your KMS keys
- Creates rows in your DynamoDB tables
- Triggers your Lambda functions (which you pay for)

### Option B: Create a Separate Public App, Keep All Private Ones

Register a brand-new fourth app as public from the start. Import its key into the same Credential Manager. Now you have:

| AppId  | Visibility | Owner         |
|--------|-----------|---------------|
| 111111 | Private   | acme-core     |
| 222222 | Private   | acme-platform |
| 333333 | Private   | acme-data     |
| 444444 | Public    | acme-platform |

This is cleaner because you can give the public app **minimal permissions** (maybe just `metadata: read`) while your private apps retain broader access. Your business logic knows which App ID is which and can apply different trust levels.

### Option C: Separate Infrastructure for Public vs Private

If you're serious about minimizing attack surface (which is priority #1), deploy **two** Credential Manager stacks:

1. **Internal stack**: manages your private apps — tightly controlled, no external exposure
2. **Public stack**: manages only the public app — separate DynamoDB tables, separate KMS keys, separate Lambda functions

This gives you complete blast-radius isolation. An abuse of the public app (rate-limit exhaustion, unexpected load) can't affect your internal operations. The cost is maintaining two stacks, but the framework makes this trivial — it's just two `new CredentialManager()` constructs in separate stacks.

### Recommendation Given Security Priority

Since minimizing vulnerability surface is the number one priority:

1. **Start with private apps only** (what the main plan already recommends)
2. If you later need public access, go with **Option C** — separate stacks. The marginal AWS cost is small (DynamoDB is pay-per-request, Lambdas only cost when invoked), and the security isolation is significant
3. Never mix trusted internal apps and untrusted public apps in the same Credential Manager unless you've explicitly accepted that risk

---

## Appendix D: Cost Analysis — Dual Infrastructure with Dev and Stage Environments

This appendix models the AWS costs for running the framework in a dual-infrastructure setup (private + public stacks, per Option C in Appendix C), with N development apps and alpha/beta/gamma promotion stages. All pricing is us-east-1 as of April 2026.

### D1. Resource Footprint Per Credential Manager Stack

Each `new CredentialManager()` deployment creates:

| Resource | Count | Configuration |
|----------|-------|---------------|
| Lambda Functions | 7 | 3 × 1024 MB (schedulers + refresher), 4 × 512 MB (API handlers) |
| DynamoDB Tables | 2 | On-demand billing, PITR enabled, 2 GSIs on installation table |
| Lambda Function URLs | 5 | IAM auth, no additional cost |
| EventBridge Scheduled Rules | 2 | Every 10 min (rate-limit tracker) + every 30 min (installation tracker) |
| CloudWatch Log Groups | 7 | One per Lambda, no retention set (logs accumulate) |
| CloudWatch Custom Metrics | 5 names | Dimensions scale with apps × installations |
| CloudWatch Dashboard | 0–1 | Only if `rateLimitDashboard()` is called |
| CloudWatch Alarm | 0–1 | Only if `rateLimitDashboard()` is called |
| X-Ray Tracing | 7 functions | Active on all Lambdas |
| KMS Keys | 1 per app | Created by ops-tools CLI, not CDK. $1/key/month |

**Not created**: No API Gateway, S3, SNS, SQS, VPC, NAT Gateway, or Secrets Manager.

### D2. Per-Stack Baseline Cost (Idle / Low Use, 1 App)

The framework is almost entirely serverless pay-per-use. The "idle" cost is what you pay when the stack is deployed but only the EventBridge schedulers are firing (no user-initiated API calls).

| Service | Monthly Cost | Notes |
|---------|-------------|-------|
| **Lambda compute** | ~$0.05 | 5,760 scheduler invocations/mo. 2 functions × 1024 MB × ~30s avg = ~2,880 GB-s. Well within 400K GB-s free tier for first stack. |
| **Lambda requests** | ~$0.00 | 5,760 requests/mo, within 1M free tier |
| **DynamoDB reads/writes** | ~$0.01 | Schedulers scan tables every 10–30 min. Minimal at low app/installation count |
| **DynamoDB storage** | ~$0.01 | <1 MB for a few apps. $0.25/GB + $0.20/GB PITR |
| **KMS key storage** | **$1.00** | $1/key/month, prorated hourly. **This is the dominant idle cost per app.** |
| **KMS RSA Sign operations** | ~$0.07 | ~4,320 signs/mo (schedulers sign JWTs per app per run). $0.015/1K signs. No free tier for asymmetric. |
| **EventBridge** | $0.00 | 5,760 invocations/mo, within 14M free tier |
| **CloudWatch metrics** | $1.50–$4.50 | 5 metric names × dimensions (AppID, InstallationID, Category). ~5–15 unique metrics at $0.30 each |
| **CloudWatch dashboard** | $0.00–$3.00 | Free if within 3-dashboard free tier; $3/mo otherwise |
| **CloudWatch alarm** | $0.00–$0.10 | Free if within 10-alarm free tier; $0.10/mo otherwise |
| **CloudWatch logs** | ~$0.03 | ~50 MB/mo ingestion at low volume. $0.50/GB ingest + accumulating storage |
| **X-Ray** | $0.00 | ~5,760 traces/mo from schedulers, within 100K free tier |
| **CloudFormation** | $0.00 | Free for AWS-native resources |
| **Total per stack (1 app)** | **~$3–$8/mo** | Range depends on dashboard/alarm and metric dimension count |

**Per additional app in the same stack**: +$1.00/mo (KMS key) + ~$0.07/mo (KMS signs) + ~$0.90–$1.50/mo (additional CloudWatch metric dimensions) ≈ **+$2–$2.50/mo per app**.

### D3. Dual Infrastructure — Internal + Public Stacks

Per Appendix C Option C, you deploy two separate Credential Manager stacks for blast-radius isolation.

| Component | Apps | Monthly Cost |
|-----------|------|-------------|
| **Internal stack** (private apps) | 3 private apps (acme-core, acme-platform, acme-data) | $3–$8 base + 2 × $2.50 additional apps = **$8–$13/mo** |
| **Public stack** (public app) | 1 public app | **$3–$8/mo** |
| **Combined baseline** | 4 apps across 2 stacks | **$11–$21/mo** |

> **Free tier note**: Lambda and X-Ray free tiers are per-account, not per-stack. The first stack largely consumes the free tier; the second stack pays full price for Lambda compute (~$0.05/mo — negligible). CloudWatch dashboard and alarm free tiers are also per-account (3 dashboards, 10 alarms).

### D4. Development Apps — Transient (Temporary) Stacks

Development apps are registered on GitHub and deployed to their own Credential Manager stack for testing, then torn down. The key question: **what does a transient dev stack actually cost?**

#### Deploy/Destroy Cycle Cost

| Resource | Cost During Lifecycle | Notes |
|----------|----------------------|-------|
| CloudFormation | $0.00 | Free for AWS resources |
| Lambda | $0.00 idle | Only charged when invoked. Schedulers fire while deployed. |
| DynamoDB | $0.00 idle | On-demand = zero cost when not accessed |
| EventBridge | $0.00 | Within free tier |
| KMS key | **$1.00/mo prorated hourly** | ~$0.00137/hour. 8-hour dev session = ~$0.011 |
| CloudWatch metrics | $0.30/metric/mo prorated | Metrics billed monthly; short-lived stacks still incur partial month |
| CloudWatch logs | Minimal | Small volume during testing |

#### Cost Per Dev Stack by Duration

| Duration | KMS Cost | CW Metrics (5 metrics) | Lambda/DDB/EB | Total |
|----------|----------|----------------------|---------------|-------|
| 1 hour | $0.001 | ~$0.002 | ~$0.00 | **~$0.003** |
| 8 hours (1 workday) | $0.011 | ~$0.017 | ~$0.01 | **~$0.04** |
| 1 week | $0.23 | ~$0.35 | ~$0.02 | **~$0.60** |
| 1 month (left running) | $1.00 | ~$1.50 | ~$0.10 | **~$2.60** |

#### N Dev Apps — Monthly Cost Scenarios

Assumes each dev app gets its own transient stack, deployed for one 8-hour workday then destroyed. N developers, each deploying once per day, 20 workdays/month.

| N (devs) | Deploys/mo | KMS Cost | CW Metrics | Compute | Total/mo |
|----------|-----------|----------|------------|---------|----------|
| 1 | 20 | $0.22 | $0.34 | $0.10 | **~$0.66** |
| 3 | 60 | $0.66 | $1.02 | $0.30 | **~$2.00** |
| 5 | 100 | $1.10 | $1.70 | $0.50 | **~$3.30** |
| 10 | 200 | $2.20 | $3.40 | $1.00 | **~$6.60** |

> **KMS cleanup warning**: If a dev deploys a stack, imports a key, then destroys the stack *without scheduling the KMS key for deletion*, the key persists at $1/mo. Over time, orphaned KMS keys become the largest cost risk. Automate cleanup or enforce a process: `aws kms schedule-key-deletion --key-id <id> --pending-window-in-days 7`.

#### Shared Dev Stack Alternative

Instead of one stack per dev, N devs share a single persistent dev stack and each registers their own GitHub App into it (multiple App IDs in one Credential Manager). Cost:

| N (apps in shared stack) | Monthly Cost |
|--------------------------|-------------|
| 1 | ~$3–$8 |
| 3 | ~$8–$13 |
| 5 | ~$13–$18 |
| 10 | ~$23–$33 |

This is more expensive per-month than transient stacks but simpler operationally — no deploy/destroy cycles, no orphaned KMS key risk.

### D5. Alpha / Beta / Gamma Stages — Persistent vs Transient

Each promotion stage (alpha → beta → gamma) can run as a persistent always-on stack or a transient deploy-on-demand stack.

#### Persistent (Always Running)

Each stage is a full Credential Manager stack that stays deployed 24/7.

| Stage | Apps | Monthly Cost |
|-------|------|-------------|
| Alpha | 1 public app | $3–$8 |
| Beta | 1 public app | $3–$8 |
| Gamma | 1 public app | $3–$8 |
| **Total (3 stages)** | | **$9–$24/mo** |

With the internal stack and public production stack included:

| Environment | Monthly Cost |
|-------------|-------------|
| Internal stack (3 private apps) | $8–$13 |
| Public production stack (1 public app) | $3–$8 |
| Alpha (1 public app) | $3–$8 |
| Beta (1 public app) | $3–$8 |
| Gamma (1 public app) | $3–$8 |
| **Grand total (persistent everything)** | **$20–$45/mo** |

#### Transient (Deploy for Testing, Destroy After)

Stages are deployed only when promoting a new version, kept alive for testing, then destroyed.

| Scenario | Duration | Cost per stage |
|----------|----------|---------------|
| Quick smoke test | 2 hours | ~$0.01 |
| Day-long validation | 8 hours | ~$0.04 |
| Week-long soak test | 1 week | ~$0.60 |
| Full release cycle (2 weeks) | 2 weeks | ~$1.20 |

Assuming one release per month flowing through all three stages (1 week each):

| Stage | Duration/mo | Monthly Cost |
|-------|------------|-------------|
| Alpha | 1 week | ~$0.60 |
| Beta | 1 week | ~$0.60 |
| Gamma | 1 week | ~$0.60 |
| **Total (3 stages, transient)** | | **~$1.80/mo** |

#### Hybrid: Persistent Gamma, Transient Alpha/Beta

A common pattern: keep gamma (pre-prod) always running for confidence, but deploy alpha/beta only during active development.

| Environment | Strategy | Monthly Cost |
|-------------|----------|-------------|
| Internal stack (3 private apps) | Persistent | $8–$13 |
| Public production (1 public app) | Persistent | $3–$8 |
| Gamma (1 public app) | Persistent | $3–$8 |
| Alpha (1 public app) | Transient, 1 week/mo | ~$0.60 |
| Beta (1 public app) | Transient, 1 week/mo | ~$0.60 |
| N=3 dev stacks | Transient, 8hr/day | ~$2.00 |
| **Grand total (hybrid)** | | **$17–$32/mo** |

### D6. Comparison Summary

| Strategy | Stacks | Monthly Cost | Operational Complexity |
|----------|--------|-------------|----------------------|
| Single stack, 1 private app | 1 | $3–$8 | Low |
| Dual infra (3 private + 1 public) | 2 | $11–$21 | Low |
| + 3 persistent stages (α/β/γ) | 5 | $20–$45 | Low (always on) |
| + 3 transient stages (α/β/γ) | 2 + on-demand | $13–$23 | Medium (deploy/destroy automation) |
| + N=3 transient dev stacks | 2 + on-demand | $13–$25 | Medium |
| Full hybrid (persistent γ, transient α/β, 3 devs) | 3 + on-demand | $17–$32 | Medium |
| Everything persistent (worst case) | 5 + N dev | $23–$50+ | Low |

### D7. Cost Optimization Recommendations

1. **KMS keys are the #1 cost driver at low scale.** At $1/key/month per app, a forgotten dev key costs more than all other resources combined. Automate key cleanup on stack destruction.

2. **CloudWatch metrics are #2.** Each unique dimension combination (AppID × InstallationID × Category) is a separate billable metric at $0.30/mo. With many apps/installations, this scales faster than compute. Consider reducing metric dimensions or using metric filters instead of custom metrics.

3. **Transient stacks are nearly free** for serverless resources. Lambda, DynamoDB on-demand, and EventBridge have zero idle cost. The only meaningful transient cost is KMS key prorating (~$0.001/hour) and CloudWatch metric partial-month charges.

4. **Set CloudWatch log retention.** The framework creates log groups with no retention policy. Logs accumulate at $0.03/GB/month for storage. Set a 30-day or 90-day retention policy on non-production stacks.

5. **Share dev stacks when possible.** A shared dev stack with N apps is operationally simpler and avoids orphaned KMS key risk, though it costs more per-month than perfectly-managed transient stacks.

6. **Free tier is per-account.** If all stacks are in one account, only the first stack benefits from Lambda (1M requests, 400K GB-s), X-Ray (100K traces), CloudWatch (3 dashboards, 10 alarms, 10 metrics), and EventBridge (14M invocations) free tiers. Multi-account strategies get free tier per account but add operational overhead.

7. **At scale, compute remains cheap.** Even at 100K API calls/month across all stacks, Lambda compute is under $5/mo total. The framework's serverless architecture means you pay almost nothing for idle infrastructure — the cost is dominated by per-resource fixed fees (KMS keys, CloudWatch metrics).