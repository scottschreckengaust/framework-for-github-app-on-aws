# ai3-mvp Plan C: Step Functions Orchestration + Reporting

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Step Functions orchestration for long-running workflows, a Jobs DynamoDB table for tracking, Check Run reporting for CI/CD, and comment-based reporting for user commands. Replace the stub handler with a real comment handler that demonstrates the full pipeline: webhook → auth → orchestration → reporting.

**Architecture:** Event handlers start Step Functions executions (Express for <5min, Standard for long). Step Functions steps call GitHub API to create/update Check Runs and post comments. Jobs table tracks all executions. DLQ + alert Lambda handles failures. Depends on Plan A (WebhookIngestion) and Plan B (OAuth + Authorization).

**Tech Stack:** AWS CDK (TypeScript), Step Functions, Lambda (Node.js 22), DynamoDB, SQS (DLQ), GitHub Checks API

**Manual steps required:** Task 7 (end-to-end verification) requires triggering events via GitHub.

---

## File Structure

```
src/packages/app-framework/src/
  webhook/
    orchestration/
      jobsTable.ts                       # Jobs table CDK construct
      startExecution.ts                  # Shared helper: start Step Functions + record job
      startExecution.test.ts             # Unit tests
      reportCheckRun.ts                  # Shared helper: create/update GitHub Check Run
      reportCheckRun.test.ts             # Unit tests
      reportComment.ts                   # Shared helper: post/edit GitHub comment
      reportComment.test.ts              # Unit tests
    handlers/
      commentHandler.ts                  # Comment handler sub-construct
      commentHandler.handler.ts          # Comment handler Lambda (auto-discovered)
      commentHandler.handler.test.ts     # Unit tests
    workflows/
      echoWorkflow.ts                    # CDK construct: simple echo Step Function
    alertHandler.ts                      # DLQ alert sub-construct
    alertHandler.handler.ts              # DLQ alert Lambda (auto-discovered)
    alertHandler.handler.test.ts         # Unit tests
    index.ts                             # Modified: add orchestration infra
    constants.ts                         # Modified: add orchestration env vars
```

---

### Task 1: Jobs Table CDK Construct

**Files:**
- Create: `src/packages/app-framework/src/webhook/orchestration/jobsTable.ts`

- [ ] **Step 1: Write the Jobs table construct**

Create `src/packages/app-framework/src/webhook/orchestration/jobsTable.ts`:

```typescript
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AttributeType,
  Table,
  BillingMode,
  ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class JobsTable extends Construct {
  readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'JobId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'RepoStatusIndex',
      partitionKey: { name: 'RepoFullName', type: AttributeType.STRING },
      sortKey: { name: 'Status', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'UserCreatedIndex',
      partitionKey: { name: 'UserId', type: AttributeType.NUMBER },
      sortKey: { name: 'CreatedAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/packages/app-framework/src/webhook/orchestration/jobsTable.ts
git commit -m "feat(orchestration): add Jobs DynamoDB table construct"
```

---

### Task 2: Reporting Helpers

**Files:**
- Create: `src/packages/app-framework/src/webhook/orchestration/reportCheckRun.ts`
- Test: `src/packages/app-framework/src/webhook/orchestration/reportCheckRun.test.ts`
- Create: `src/packages/app-framework/src/webhook/orchestration/reportComment.ts`
- Test: `src/packages/app-framework/src/webhook/orchestration/reportComment.test.ts`

- [ ] **Step 1: Write failing tests for reportCheckRun**

Create `src/packages/app-framework/src/webhook/orchestration/reportCheckRun.test.ts`:

```typescript
import { createCheckRun, updateCheckRun } from './reportCheckRun';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('reportCheckRun', () => {
  beforeEach(() => mockFetch.mockReset());

  it('creates a check run and returns its id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 42 }),
    });
    const id = await createCheckRun({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      headSha: 'abc123',
      name: 'ai3-mvp / deploy',
      status: 'in_progress',
    });
    expect(id).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/check-runs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updates a check run status', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateCheckRun({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      checkRunId: 42,
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Deploy succeeded', summary: 'All steps passed' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/check-runs/42',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
```

- [ ] **Step 2: Write failing tests for reportComment**

Create `src/packages/app-framework/src/webhook/orchestration/reportComment.test.ts`:

```typescript
import { postComment, updateComment } from './reportComment';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('reportComment', () => {
  beforeEach(() => mockFetch.mockReset());

  it('posts a new comment and returns its id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 99 }),
    });
    const id = await postComment({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      issueNumber: 5,
      body: 'Working on it...',
    });
    expect(id).toBe(99);
  });

  it('updates an existing comment', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateComment({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      commentId: 99,
      body: 'Done!',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/issues/comments/99',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src/packages/app-framework && npx jest --testPathPattern='report(CheckRun|Comment).test' -v`
Expected: FAIL — Cannot find modules

- [ ] **Step 4: Write reportCheckRun implementation**

Create `src/packages/app-framework/src/webhook/orchestration/reportCheckRun.ts`:

```typescript
export interface CreateCheckRunInput {
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out';
  output?: { title: string; summary: string };
}

export interface UpdateCheckRunInput {
  token: string;
  owner: string;
  repo: string;
  checkRunId: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out';
  output?: { title: string; summary: string };
}

export async function createCheckRun(input: CreateCheckRunInput): Promise<number> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        head_sha: input.headSha,
        status: input.status,
        conclusion: input.conclusion,
        output: input.output,
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to create check run: ${resp.status}`);
  }
  const data = (await resp.json()) as { id: number };
  return data.id;
}

export async function updateCheckRun(input: UpdateCheckRunInput): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: input.status,
        conclusion: input.conclusion,
        output: input.output,
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to update check run: ${resp.status}`);
  }
}
```

- [ ] **Step 5: Write reportComment implementation**

Create `src/packages/app-framework/src/webhook/orchestration/reportComment.ts`:

```typescript
export interface PostCommentInput {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface UpdateCommentInput {
  token: string;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
}

export async function postComment(input: PostCommentInput): Promise<number> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: input.body }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to post comment: ${resp.status}`);
  }
  const data = (await resp.json()) as { id: number };
  return data.id;
}

export async function updateComment(input: UpdateCommentInput): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/issues/comments/${input.commentId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: input.body }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to update comment: ${resp.status}`);
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern='report(CheckRun|Comment).test' -v`
Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/packages/app-framework/src/webhook/orchestration/reportCheckRun.ts src/packages/app-framework/src/webhook/orchestration/reportCheckRun.test.ts src/packages/app-framework/src/webhook/orchestration/reportComment.ts src/packages/app-framework/src/webhook/orchestration/reportComment.test.ts
git commit -m "feat(orchestration): add Check Run and comment reporting helpers"
```

---

### Task 3: Start Execution Helper

**Files:**
- Create: `src/packages/app-framework/src/webhook/orchestration/startExecution.ts`
- Test: `src/packages/app-framework/src/webhook/orchestration/startExecution.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/orchestration/startExecution.test.ts`:

```typescript
import { startExecution } from './startExecution';

const mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockDynamoSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

describe('startExecution', () => {
  beforeEach(() => {
    mockSfnSend.mockReset();
    mockDynamoSend.mockReset();
    process.env.JOBS_TABLE_NAME = 'test-jobs';
  });

  it('starts a step function and records the job', async () => {
    mockSfnSend.mockResolvedValue({
      executionArn: 'arn:aws:states:us-east-1:123:execution:test:abc',
    });
    mockDynamoSend.mockResolvedValue({});

    const result = await startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
      input: { message: 'hello' },
      userId: 12345,
      repoFullName: 'sbalswa/test-repo',
    });

    expect(result.jobId).toBeDefined();
    expect(result.executionArn).toContain('execution');
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=startExecution.test -v`
Expected: FAIL — `Cannot find module './startExecution'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/orchestration/startExecution.ts`:

```typescript
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({});

export interface StartExecutionInput {
  stateMachineArn: string;
  input: Record<string, unknown>;
  userId: number;
  repoFullName: string;
  checkRunId?: number;
}

export interface StartExecutionResult {
  jobId: string;
  executionArn: string;
}

export async function startExecution(
  params: StartExecutionInput,
): Promise<StartExecutionResult> {
  const jobId = randomUUID();
  const now = new Date().toISOString();

  const sfnResp = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: params.stateMachineArn,
      name: jobId,
      input: JSON.stringify({
        ...params.input,
        jobId,
      }),
    }),
  );

  const executionArn = sfnResp.executionArn!;

  const tableName = process.env.JOBS_TABLE_NAME;
  if (!tableName) throw new Error('JOBS_TABLE_NAME not set');

  const item: Record<string, { S?: string; N?: string }> = {
    JobId: { S: jobId },
    ExecutionArn: { S: executionArn },
    Status: { S: 'RUNNING' },
    UserId: { N: String(params.userId) },
    RepoFullName: { S: params.repoFullName },
    CreatedAt: { S: now },
    UpdatedAt: { S: now },
  };
  if (params.checkRunId) {
    item.CheckRunId = { N: String(params.checkRunId) };
  }

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item,
    }),
  );

  return { jobId, executionArn };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=startExecution.test -v`
Expected: 1 test PASS

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/orchestration/startExecution.ts src/packages/app-framework/src/webhook/orchestration/startExecution.test.ts
git commit -m "feat(orchestration): add Step Functions execution starter with job tracking"
```

---

### Task 4: Comment Handler (Replaces Stub)

**Files:**
- Create: `src/packages/app-framework/src/webhook/handlers/commentHandler.handler.ts`
- Test: `src/packages/app-framework/src/webhook/handlers/commentHandler.handler.test.ts`
- Create: `src/packages/app-framework/src/webhook/handlers/commentHandler.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/handlers/commentHandler.handler.test.ts`:

```typescript
import { handler } from './commentHandler.handler';

const mockAuthorizeUser = jest.fn();
jest.mock('../auth/authorizeUser', () => ({
  authorizeUser: (...args: unknown[]) => mockAuthorizeUser(...args),
}));

const mockPostComment = jest.fn();
jest.mock('../orchestration/reportComment', () => ({
  postComment: (...args: unknown[]) => mockPostComment(...args),
}));

describe('commentHandler', () => {
  beforeEach(() => {
    mockAuthorizeUser.mockReset();
    mockPostComment.mockReset();
    process.env.APP_ID = '3501081';
    process.env.INSTALLATION_TOKEN_ENDPOINT = 'https://example.com/';
    process.env.ORG_NAME = 'sbalswa';
  });

  it('replies with auth link when user needs authorization', async () => {
    mockAuthorizeUser.mockResolvedValue({
      authorized: false,
      needsAuth: true,
    });
    mockPostComment.mockResolvedValue(1);

    const event = {
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'del-1',
        action: 'created',
        sender: { login: 'newuser', id: 111 },
        repository: { full_name: 'sbalswa/test-repo', owner: { login: 'sbalswa' } },
        payload: {
          comment: { body: '@ai3-mvp hello' },
          issue: { number: 5 },
        },
      },
    };

    await handler(event as any);
    expect(mockPostComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('authorize'),
      }),
    );
  });

  it('skips comments not mentioning the bot', async () => {
    const event = {
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'del-2',
        action: 'created',
        sender: { login: 'someone', id: 222 },
        repository: { full_name: 'sbalswa/test-repo', owner: { login: 'sbalswa' } },
        payload: {
          comment: { body: 'just a regular comment' },
          issue: { number: 5 },
        },
      },
    };

    await handler(event as any);
    expect(mockAuthorizeUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=commentHandler.handler.test -v`
Expected: FAIL — `Cannot find module './commentHandler.handler'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/handlers/commentHandler.handler.ts`:

```typescript
import { authorizeUser } from '../auth/authorizeUser';
import { postComment } from '../orchestration/reportComment';

const BOT_MENTION = '@ai3-mvp';

interface CommentEvent {
  'detail-type': string;
  detail: {
    delivery_id: string;
    action: string;
    sender: { login: string; id: number };
    repository: { full_name: string; owner: { login: string } };
    payload: {
      comment: { body: string };
      issue: { number: number };
    };
  };
}

export const handler = async (event: CommentEvent): Promise<void> => {
  const { detail } = event;
  const commentBody = detail.payload.comment.body;

  if (!commentBody.includes(BOT_MENTION)) {
    return;
  }

  if (detail.action !== 'created') {
    return;
  }

  const [owner, repo] = detail.repository.full_name.split('/');
  const orgName = process.env.ORG_NAME || owner;

  const installationToken = 'placeholder';

  const authResult = await authorizeUser({
    senderLogin: detail.sender.login,
    senderId: detail.sender.id,
    repoFullName: detail.repository.full_name,
    installationToken,
    orgName,
  });

  if (!authResult.authorized) {
    if (authResult.needsAuth) {
      const authUrl = process.env.AUTH_LOGIN_URL || '';
      await postComment({
        token: installationToken,
        owner,
        repo,
        issueNumber: detail.payload.issue.number,
        body: `@${detail.sender.login} I need you to [authorize this app](${authUrl}?repo=${detail.repository.full_name}&issue=${detail.payload.issue.number}) before I can act on your behalf.`,
      });
    } else {
      await postComment({
        token: installationToken,
        owner,
        repo,
        issueNumber: detail.payload.issue.number,
        body: `@${detail.sender.login} ${authResult.reason}`,
      });
    }
    return;
  }

  await postComment({
    token: installationToken,
    owner,
    repo,
    issueNumber: detail.payload.issue.number,
    body: `@${detail.sender.login} Received your command. Processing...`,
  });

  console.log(JSON.stringify({
    handler: 'commentHandler',
    deliveryId: detail.delivery_id,
    sender: detail.sender.login,
    command: commentBody.replace(BOT_MENTION, '').trim(),
  }));
};
```

- [ ] **Step 4: Write the sub-construct**

Create `src/packages/app-framework/src/webhook/handlers/commentHandler.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface CommentHandlerProps {
  readonly userTokensTableName: string;
  readonly orgName: string;
  readonly authLoginUrl: string;
}

export class CommentHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: CommentHandlerProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles issue_comment events mentioning @ai3-mvp',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        USER_TOKENS_TABLE_NAME: props.userTokensTableName,
        ORG_NAME: props.orgName,
        AUTH_LOGIN_URL: props.authLoginUrl,
      },
    });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=commentHandler.handler.test -v`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/packages/app-framework/src/webhook/handlers/commentHandler.handler.ts src/packages/app-framework/src/webhook/handlers/commentHandler.handler.test.ts src/packages/app-framework/src/webhook/handlers/commentHandler.ts
git commit -m "feat(orchestration): add comment handler with auth integration"
```

---

### Task 5: DLQ Alert Handler

**Files:**
- Create: `src/packages/app-framework/src/webhook/alertHandler.handler.ts`
- Test: `src/packages/app-framework/src/webhook/alertHandler.handler.test.ts`
- Create: `src/packages/app-framework/src/webhook/alertHandler.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/alertHandler.handler.test.ts`:

```typescript
import { handler } from './alertHandler.handler';

describe('alertHandler', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  afterEach(() => consoleSpy.mockClear());
  afterAll(() => consoleSpy.mockRestore());

  it('logs failed events from DLQ', async () => {
    const event = {
      Records: [
        {
          body: JSON.stringify({
            source: 'github',
            'detail-type': 'push',
            detail: { delivery_id: 'failed-1' },
          }),
          messageId: 'msg-1',
        },
      ],
    };
    await handler(event);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed-1'),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=alertHandler.handler.test -v`
Expected: FAIL — `Cannot find module './alertHandler.handler'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/alertHandler.handler.ts`:

```typescript
import { SQSEvent } from 'aws-lambda';

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    console.error(
      JSON.stringify({
        alert: 'DLQ_EVENT',
        messageId: record.messageId,
        body: record.body,
      }),
    );
  }
};
```

- [ ] **Step 4: Write the sub-construct**

Create `src/packages/app-framework/src/webhook/alertHandler.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../lambdaDefaults';

export class AlertHandler extends Construct {
  readonly lambdaHandler: NodejsFunction;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
    });

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Processes failed events from DLQ',
      memorySize: 256,
      timeout: Duration.seconds(30),
    });

    this.lambdaHandler.addEventSource(
      new SqsEventSource(this.dlq, { batchSize: 10 }),
    );
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=alertHandler.handler.test -v`
Expected: 1 test PASS

- [ ] **Step 6: Commit**

```bash
git add src/packages/app-framework/src/webhook/alertHandler.handler.ts src/packages/app-framework/src/webhook/alertHandler.handler.test.ts src/packages/app-framework/src/webhook/alertHandler.ts
git commit -m "feat(orchestration): add DLQ alert handler"
```

---

### Task 6: Update WebhookIngestion with Orchestration

**Files:**
- Modify: `src/packages/app-framework/src/webhook/index.ts`
- Modify: `src/packages/app-framework/src/webhook/constants.ts`

- [ ] **Step 1: Update constants**

Add to `src/packages/app-framework/src/webhook/constants.ts`:

```typescript
export const OrchestrationEnvironmentVariables = {
  JOBS_TABLE_NAME: 'JOBS_TABLE_NAME',
  AUTH_LOGIN_URL: 'AUTH_LOGIN_URL',
  ORG_NAME: 'ORG_NAME',
} as const;
```

- [ ] **Step 2: Update WebhookIngestion construct**

Modify `src/packages/app-framework/src/webhook/index.ts`:

Add imports:
```typescript
import { JobsTable } from './orchestration/jobsTable';
import { CommentHandler } from './handlers/commentHandler';
import { AlertHandler } from './alertHandler';
```

Add class properties:
```typescript
  readonly jobsTable?: Table;
```

Inside the constructor, after the OAuth block and before the stub handler, add:

```typescript
    // Orchestration infrastructure
    const jobs = new JobsTable(this, 'Jobs');
    this.jobsTable = jobs.table;

    const alert = new AlertHandler(this, 'Alert');

    // Comment handler (replaces stub for issue_comment events)
    if (props.gitHubClientId) {
      const authLoginUrl = api.urlForPath('/auth/login');
      const comment = new CommentHandler(this, 'CommentHandler', {
        userTokensTableName: this.userTokensTable?.tableName || '',
        orgName: 'sbalswa',
        authLoginUrl,
      });

      if (this.userTokensTable) {
        this.userTokensTable.grantReadData(comment.lambdaHandler);
      }

      new Rule(this, 'IssueCommentRule', {
        eventBus: this.eventBus,
        eventPattern: {
          source: ['github'],
          detailType: ['issue_comment'],
        },
        targets: [new LambdaFunction(comment.lambdaHandler, {
          deadLetterQueue: alert.dlq,
        })],
      });
    }
```

Change the existing stub catch-all rule to exclude issue_comment (so it doesn't double-fire):

```typescript
    new Rule(this, 'AllEventsRule', {
      eventBus: this.eventBus,
      eventPattern: {
        source: ['github'],
        detailType: [{ 'anything-but': 'issue_comment' }] as any[],
      },
      targets: [new LambdaFunction(stub.lambdaHandler, {
        deadLetterQueue: alert.dlq,
      })],
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/packages/app-framework/src/webhook/index.ts src/packages/app-framework/src/webhook/constants.ts
git commit -m "feat(orchestration): wire Jobs table, comment handler, and DLQ into WebhookIngestion"
```

---

### Task 7: Build, Deploy, and End-to-End Verification

**Files:** None (build + deploy + manual testing)

- [ ] **Step 1: Build**

Run: `npx projen build`
Expected: All tests pass.

- [ ] **Step 2: Deploy**

Run (replace ARNs):
```bash
cd src/packages/app-framework-test-app && \
AWS_PROFILE=burner2 npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<webhook-secret-arn> \
  --context gitHubClientId=Iv23li6ndiRoICMS3xab \
  --context oauthClientSecretArn=<oauth-client-secret-arn> \
  --outputs-file /tmp/cdk-output.json \
  --require-approval never
```

- [ ] **Step 3: Test comment handler (MANUAL)**

Go to any issue in a `sbalswa` repo and comment:
```
@ai3-mvp hello
```

Expected: The bot replies with either:
- An "authorize" link (if you haven't OAuth'd yet)
- "Received your command. Processing..." (if you have)

- [ ] **Step 4: Verify Jobs table exists**

Run:
```bash
AWS_PROFILE=burner2 aws dynamodb list-tables --region us-east-1 \
  --query 'TableNames[?contains(@, `Jobs`)]'
```

Expected: Shows the Jobs table name.

- [ ] **Step 5: Verify DLQ is empty (no failures)**

Run:
```bash
AWS_PROFILE=burner2 aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1
```

Expected: `ApproximateNumberOfMessages: 0`

---

## Summary

After completing this plan you will have:
- Jobs DynamoDB table with GSIs for repo and user queries
- GitHub Check Run create/update helpers
- GitHub comment post/edit helpers
- Step Functions execution starter with job tracking
- Comment handler that authenticates users and responds
- DLQ with alert handler for failed events
- Full pipeline: webhook → EventBridge → auth → handler → reporting
