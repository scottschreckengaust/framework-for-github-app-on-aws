# ai3-mvp Plan A: Webhook Ingestion + EventBridge Routing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receive GitHub webhook events via API Gateway, verify signatures, and route them to handler Lambdas via EventBridge. Deploy with a stub handler that logs events to prove the pipeline works end-to-end.

**Architecture:** API Gateway REST API with WAF → Webhook Receiver Lambda (signature verification) → EventBridge custom bus → EventBridge rules per event type → Handler Lambdas. Built as a new CDK construct (`WebhookIngestion`) alongside the existing `CredentialManager`.

**Tech Stack:** AWS CDK (TypeScript), API Gateway, Lambda (Node.js 22), EventBridge, WAF, Secrets Manager, DynamoDB (for idempotency)

**Manual steps required:** Task 1 (GitHub App config changes) and Task 8 (end-to-end verification) require manual browser/CLI actions by the operator.

---

## File Structure

Follows existing codebase pattern: each Lambda gets its own sub-construct
directory. The construct file is `<name>.ts` and CDK auto-discovers the
handler file as `<name>.handler.ts` in the same directory.

```
src/packages/app-framework/src/
  webhook/
    index.ts                         # WebhookIngestion CDK construct (top-level wiring)
    constants.ts                     # Environment variable names, tag keys
    receiver/
      webhookReceiver.ts             # Receiver sub-construct (Lambda + permissions)
      webhookReceiver.handler.ts     # Receiver Lambda handler (auto-discovered)
      verifySignature.ts             # HMAC-SHA256 signature verification
      verifySignature.test.ts        # Unit tests for signature verification
    handlers/
      stubHandler.ts                 # Stub sub-construct (Lambda)
      stubHandler.handler.ts         # Stub Lambda handler (auto-discovered)
      stubHandler.handler.test.ts    # Unit test for stub handler

src/packages/app-framework-test-app/src/
  main.ts                            # Modified: add WebhookIngestion construct
```

---

### Task 1: Configure GitHub App for Webhooks (MANUAL)

**Files:** None (browser + CLI actions)

This task must be done by the operator before the webhook pipeline can receive events.

- [ ] **Step 1: Generate a webhook secret**

Run:
```bash
openssl rand -hex 32
```
Save the output — this is your webhook secret.

- [ ] **Step 2: Store the webhook secret in AWS Secrets Manager**

Run:
```bash
AWS_PROFILE=burner2 aws secretsmanager create-secret \
  --name ai3-mvp/webhook-secret \
  --secret-string "<output-from-step-1>" \
  --region us-east-1
```
Expected: JSON response with `ARN` and `Name`.

- [ ] **Step 3: Note the secret ARN**

Copy the `ARN` from the output. You will need it in Task 4 when configuring the CDK construct. It will look like:
`arn:aws:secretsmanager:us-east-1:361116840407:secret:ai3-mvp/webhook-secret-XXXXXX`

- [ ] **Step 4: Update the GitHub App webhook settings (after Task 7 deploy)**

This step happens AFTER the stack is deployed in Task 7. Go to:
`github.com/organizations/sbalswa/settings/apps/ai3-mvp`

Set:
- **Webhook URL**: The API Gateway endpoint URL from the CDK deploy output
- **Webhook secret**: The secret value from Step 1
- **Active**: Check the box
- **Events**: Subscribe to: `issue_comment`, `pull_request`, `push`, `repository`, `star`, `check_run`, `deployment`, `create`, `delete`, `member`, `organization`

---

### Task 2: Webhook Signature Verification Module

**Files:**
- Create: `src/packages/app-framework/src/webhook/receiver/verifySignature.ts`
- Test: `src/packages/app-framework/src/webhook/receiver/verifySignature.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/packages/app-framework/src/webhook/receiver/verifySignature.test.ts`:

```typescript
import { verifySignature } from './verifySignature';
import { createHmac } from 'crypto';

const SECRET = 'test-webhook-secret-value';

function sign(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

describe('verifySignature', () => {
  it('returns true for a valid signature', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature(body, signature, SECRET)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const body = '{"action":"opened"}';
    const signature = 'sha256=deadbeef';
    expect(verifySignature(body, signature, SECRET)).toBe(false);
  });

  it('returns false for a missing signature', () => {
    const body = '{"action":"opened"}';
    expect(verifySignature(body, '', SECRET)).toBe(false);
  });

  it('returns false for a tampered body', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature('{"action":"closed"}', signature, SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature(body, signature, 'wrong-secret')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=verifySignature.test -v`
Expected: FAIL — `Cannot find module './verifySignature'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/receiver/verifySignature.ts`:

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  const actual = signature.slice('sha256='.length);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=verifySignature.test -v`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/receiver/verifySignature.ts src/packages/app-framework/src/webhook/receiver/verifySignature.test.ts
git commit -m "feat(webhook): add HMAC-SHA256 signature verification module"
```

---

### Task 3: Webhook Receiver Lambda Handler

**Files:**
- Create: `src/packages/app-framework/src/webhook/receiver/webhookReceiver.handler.ts`
- Create: `src/packages/app-framework/src/webhook/constants.ts`

- [ ] **Step 1: Create constants file**

Create `src/packages/app-framework/src/webhook/constants.ts`:

```typescript
export const WebhookEnvironmentVariables = {
  WEBHOOK_SECRET_ARN: 'WEBHOOK_SECRET_ARN',
  EVENT_BUS_NAME: 'EVENT_BUS_NAME',
  IDEMPOTENCY_TABLE_NAME: 'IDEMPOTENCY_TABLE_NAME',
} as const;
```

- [ ] **Step 2: Write the receiver Lambda handler**

Create `src/packages/app-framework/src/webhook/receiver/webhookReceiver.handler.ts`:

```typescript
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  DynamoDBClient,
  PutItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { verifySignature } from './verifySignature';
import { WebhookEnvironmentVariables } from '../constants';

const secretsClient = new SecretsManagerClient({});
const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = new DynamoDBClient({});

let cachedSecret: string | undefined;

async function getWebhookSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const arn = process.env[WebhookEnvironmentVariables.WEBHOOK_SECRET_ARN];
  if (!arn) throw new Error('WEBHOOK_SECRET_ARN not set');
  const resp = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  cachedSecret = resp.SecretString;
  if (!cachedSecret) throw new Error('Webhook secret is empty');
  return cachedSecret;
}

async function checkIdempotency(deliveryId: string): Promise<boolean> {
  const tableName =
    process.env[WebhookEnvironmentVariables.IDEMPOTENCY_TABLE_NAME];
  if (!tableName) throw new Error('IDEMPOTENCY_TABLE_NAME not set');
  try {
    await dynamoClient.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          DeliveryId: { S: deliveryId },
          ReceivedAt: { S: new Date().toISOString() },
          TTL: { N: String(Math.floor(Date.now() / 1000) + 86400) },
        },
        ConditionExpression: 'attribute_not_exists(DeliveryId)',
      }),
    );
    return true;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) return false;
    throw e;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const signature = event.headers['x-hub-signature-256'] || '';
  const deliveryId = event.headers['x-github-delivery'] || '';
  const eventType = event.headers['x-github-event'] || '';
  const body = event.body || '';

  if (!deliveryId || !eventType) {
    return { statusCode: 400, body: 'Missing required GitHub headers' };
  }

  const secret = await getWebhookSecret();
  if (!verifySignature(body, signature, secret)) {
    console.error('Webhook signature verification failed', { deliveryId });
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const isNew = await checkIdempotency(deliveryId);
  if (!isNew) {
    console.log('Duplicate delivery, skipping', { deliveryId });
    return { statusCode: 200, body: 'Duplicate delivery' };
  }

  const busName = process.env[WebhookEnvironmentVariables.EVENT_BUS_NAME];
  if (!busName) throw new Error('EVENT_BUS_NAME not set');

  const payload = JSON.parse(body);

  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'github',
          DetailType: eventType,
          Detail: JSON.stringify({
            delivery_id: deliveryId,
            action: payload.action,
            sender: payload.sender,
            repository: payload.repository,
            organization: payload.organization,
            installation: payload.installation,
            payload,
          }),
          EventBusName: busName,
        },
      ],
    }),
  );

  console.log('Event dispatched', { deliveryId, eventType });
  return { statusCode: 200, body: 'OK' };
};
```

- [ ] **Step 3: Commit**

```bash
git add src/packages/app-framework/src/webhook/constants.ts src/packages/app-framework/src/webhook/receiver/webhookReceiver.handler.ts
git commit -m "feat(webhook): add receiver Lambda handler with idempotency"
```

---

### Task 4: Stub Event Handler Lambda

**Files:**
- Create: `src/packages/app-framework/src/webhook/handlers/stubHandler.handler.ts`
- Test: `src/packages/app-framework/src/webhook/handlers/stubHandler.handler.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/handlers/stubHandler.handler.test.ts`:

```typescript
import { handler } from './stubHandler.handler';

describe('stub event handler', () => {
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

  afterEach(() => consoleSpy.mockClear());
  afterAll(() => consoleSpy.mockRestore());

  it('logs the event type and delivery id', async () => {
    const event = {
      source: 'github',
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'abc-123',
        action: 'created',
        sender: { login: 'testuser' },
        repository: { full_name: 'sbalswa/test-repo' },
      },
    };
    const result = await handler(event);
    expect(result).toEqual({ received: true });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('issue_comment'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('abc-123'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=stubHandler.handler.test -v`
Expected: FAIL — `Cannot find module './stubHandler.handler'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/handlers/stubHandler.handler.ts`:

```typescript
interface GitHubEventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: {
    delivery_id: string;
    action?: string;
    sender?: { login: string };
    repository?: { full_name: string };
    [key: string]: unknown;
  };
}

export const handler = async (
  event: GitHubEventBridgeEvent,
): Promise<{ received: boolean }> => {
  console.log(
    JSON.stringify({
      eventType: event['detail-type'],
      deliveryId: event.detail.delivery_id,
      action: event.detail.action,
      sender: event.detail.sender?.login,
      repo: event.detail.repository?.full_name,
    }),
  );
  return { received: true };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=stubHandler.handler.test -v`
Expected: 1 test PASS

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/handlers/stubHandler.handler.ts src/packages/app-framework/src/webhook/handlers/stubHandler.handler.test.ts
git commit -m "feat(webhook): add stub event handler for pipeline testing"
```

---

### Task 5: WebhookIngestion CDK Construct

**Files:**
- Create: `src/packages/app-framework/src/webhook/receiver/webhookReceiver.ts`
- Create: `src/packages/app-framework/src/webhook/handlers/stubHandler.ts`
- Create: `src/packages/app-framework/src/webhook/index.ts`

- [ ] **Step 1: Write the receiver sub-construct**

Create `src/packages/app-framework/src/webhook/receiver/webhookReceiver.ts`:

This follows the same pattern as `get-app-token/appToken.ts` — a Construct that
creates a `NodejsFunction`. CDK auto-discovers `webhookReceiver.handler.ts` in
the same directory because the construct ID matches the file prefix.

```typescript
import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';
import { WebhookEnvironmentVariables } from '../constants';

export interface WebhookReceiverProps {
  readonly webhookSecret: ISecret;
  readonly webhookSecretArn: string;
  readonly eventBus: EventBus;
  readonly idempotencyTable: Table;
}

export class WebhookReceiver extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: WebhookReceiverProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Receives GitHub webhooks, verifies signatures, dispatches to EventBridge',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        [WebhookEnvironmentVariables.WEBHOOK_SECRET_ARN]: props.webhookSecretArn,
        [WebhookEnvironmentVariables.EVENT_BUS_NAME]: props.eventBus.eventBusName,
        [WebhookEnvironmentVariables.IDEMPOTENCY_TABLE_NAME]: props.idempotencyTable.tableName,
      },
    });

    props.webhookSecret.grantRead(this.lambdaHandler);
    props.idempotencyTable.grantWriteData(this.lambdaHandler);
    props.eventBus.grantPutEventsTo(this.lambdaHandler);
  }
}
```

- [ ] **Step 2: Write the stub handler sub-construct**

Create `src/packages/app-framework/src/webhook/handlers/stubHandler.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export class StubHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Stub handler that logs all GitHub events',
      memorySize: 256,
      timeout: Duration.seconds(30),
    });
  }
}
```

- [ ] **Step 3: Write the top-level WebhookIngestion construct**

Create `src/packages/app-framework/src/webhook/index.ts`:

```typescript
import { RemovalPolicy, Tags } from 'aws-cdk-lib';
import {
  LambdaIntegration,
  RestApi,
  MethodLoggingLevel,
} from 'aws-cdk-lib/aws-apigateway';
import { AttributeType, Table, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { EventBus, Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import {
  CfnWebACL,
  CfnWebACLAssociation,
} from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';
import { WebhookReceiver } from './receiver/webhookReceiver';
import { StubHandler } from './handlers/stubHandler';

export interface WebhookIngestionProps {
  readonly webhookSecretArn: string;
}

export class WebhookIngestion extends Construct {
  readonly eventBus: EventBus;
  readonly apiEndpoint: string;

  constructor(scope: Construct, id: string, props: WebhookIngestionProps) {
    super(scope, id);

    const webhookSecret = Secret.fromSecretCompleteArn(
      this,
      'WebhookSecret',
      props.webhookSecretArn,
    );

    this.eventBus = new EventBus(this, 'GitHubEventBus', {
      eventBusName: 'ai3-mvp-github-events',
    });

    const idempotencyTable = new Table(this, 'IdempotencyTable', {
      partitionKey: { name: 'DeliveryId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'TTL',
    });

    const receiver = new WebhookReceiver(this, 'Receiver', {
      webhookSecret,
      webhookSecretArn: props.webhookSecretArn,
      eventBus: this.eventBus,
      idempotencyTable,
    });

    const api = new RestApi(this, 'WebhookApi', {
      restApiName: 'ai3-mvp-webhook',
      deployOptions: {
        loggingLevel: MethodLoggingLevel.INFO,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const webhookResource = api.root.addResource('webhook');
    webhookResource.addMethod(
      'POST',
      new LambdaIntegration(receiver.lambdaHandler),
    );

    this.apiEndpoint = api.urlForPath('/webhook');

    const webAcl = new CfnWebACL(this, 'WebhookWAF', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'ai3-mvp-webhook-waf',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'RateLimit',
          priority: 1,
          action: { block: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'ai3-mvp-webhook-ratelimit',
            sampledRequestsEnabled: true,
          },
          statement: {
            rateBasedStatement: {
              limit: 1000,
              aggregateKeyType: 'IP',
            },
          },
        },
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          overrideAction: { none: {} },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'ai3-mvp-webhook-common-rules',
            sampledRequestsEnabled: true,
          },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
        },
      ],
    });

    new CfnWebACLAssociation(this, 'WebhookWAFAssociation', {
      resourceArn: api.deploymentStage.stageArn,
      webAclArn: webAcl.attrArn,
    });

    const stub = new StubHandler(this, 'StubHandler');

    new Rule(this, 'AllEventsRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
      },
      targets: [new LambdaFunction(stub.lambdaHandler)],
    });

    Tags.of(this).add('ai3-mvp', 'WebhookIngestion');
  }
}
```

- [ ] **Step 4: Export the construct**

Add to `src/packages/app-framework/src/index.ts` (which currently only exports CredentialManager):

Append this line:
```typescript
export { WebhookIngestion, WebhookIngestionProps } from './webhook';
```

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/receiver/webhookReceiver.ts src/packages/app-framework/src/webhook/handlers/stubHandler.ts src/packages/app-framework/src/webhook/index.ts src/packages/app-framework/src/index.ts
git commit -m "feat(webhook): add WebhookIngestion CDK construct with API GW + WAF + EventBridge"
```

---

### Task 6: Wire into Test App Stack

**Files:**
- Modify: `src/packages/app-framework-test-app/src/main.ts`

- [ ] **Step 1: Update the test app to include WebhookIngestion**

Modify `src/packages/app-framework-test-app/src/main.ts`. Add these imports and construct usage:

At the top, change the import to include `WebhookIngestion`:
```typescript
import { CredentialManager, WebhookIngestion } from '@aws/app-framework-for-github-apps-on-aws';
```

Inside the constructor, after the `CredentialManager` block and before the `Region` output, add:

```typescript
    const webhookSecretArn = this.node.tryGetContext('webhookSecretArn') as string;
    if (webhookSecretArn) {
      const webhook = new WebhookIngestion(this, 'WebhookIngestion', {
        webhookSecretArn,
      });
      new CfnOutput(this, 'WebhookEndpoint', {
        value: webhook.apiEndpoint,
        exportName: 'WebhookEndpoint',
      });
    }
```

- [ ] **Step 2: Commit**

```bash
git add src/packages/app-framework-test-app/src/main.ts
git commit -m "feat(test-app): wire WebhookIngestion into test app stack"
```

---

### Task 7: Build and Deploy

**Files:** None (build + deploy commands)

- [ ] **Step 1: Build the framework**

Run:
```bash
npx projen build
```
Expected: All packages compile, tests pass. If there are import errors, check that the `webhook/` directory files are included in the TypeScript compilation.

- [ ] **Step 2: Deploy with the webhook secret ARN**

Run (replace the secret ARN with the one from Task 1 Step 3):
```bash
cd src/packages/app-framework-test-app && \
AWS_PROFILE=burner2 npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=arn:aws:secretsmanager:us-east-1:361116840407:secret:ai3-mvp/webhook-secret-XXXXXX \
  --outputs-file /tmp/cdk-output.json \
  --require-approval never
```
Expected: Stack deploys successfully. Output includes `WebhookEndpoint`.

- [ ] **Step 3: Note the webhook endpoint URL**

Run:
```bash
cat /tmp/cdk-output.json | grep WebhookEndpoint
```
Copy this URL — you need it for Task 1 Step 4 (configuring the GitHub App).

- [ ] **Step 4: Commit (no code changes, just checkpoint)**

No commit needed — this was a deploy step.

---

### Task 8: End-to-End Verification (MANUAL)

**Files:** None (browser + CLI verification)

- [ ] **Step 1: Complete Task 1 Step 4 (configure GitHub App webhook URL)**

Go to `github.com/organizations/sbalswa/settings/apps/ai3-mvp` and set the Webhook URL to the endpoint from Task 7 Step 3.

- [ ] **Step 2: Trigger a test event**

Go to any repo in the `sbalswa` org and star/unstar it. This sends a `star` webhook event.

- [ ] **Step 3: Check the stub handler CloudWatch logs**

Run:
```bash
AWS_PROFILE=burner2 aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/the-app-framework-test-stack \
  --region us-east-1 \
  --query 'logGroups[*].logGroupName' --output text
```

Find the StubHandler log group, then:
```bash
AWS_PROFILE=burner2 aws logs tail \
  /aws/lambda/the-app-framework-test-stack-WebhookIngestionStubHandler... \
  --since 5m --region us-east-1
```

Expected: A log entry showing `eventType: "star"`, the delivery ID, your GitHub username, and the repo name.

- [ ] **Step 4: Verify idempotency**

Redeliver the same event from GitHub App settings → Advanced → Recent Deliveries → Redeliver. Check logs again — should see "Duplicate delivery, skipping" message with no new EventBridge dispatch.

- [ ] **Step 5: Verify WAF is active**

Run:
```bash
AWS_PROFILE=burner2 aws wafv2 get-web-acl-for-resource \
  --resource-arn <api-gateway-stage-arn> \
  --region us-east-1
```
Expected: Returns the WAF Web ACL details.

---

## Summary

After completing this plan you will have:
- API Gateway endpoint receiving GitHub webhooks with WAF protection
- HMAC-SHA256 signature verification
- Idempotent event processing (DynamoDB dedup on delivery GUID)
- EventBridge custom bus routing events by type
- A stub handler proving the full pipeline works
- Ready for Plan B (OAuth + Authorization) to add real handlers
