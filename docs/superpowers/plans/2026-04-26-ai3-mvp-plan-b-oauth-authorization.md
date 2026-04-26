# ai3-mvp Plan B: OAuth Flow + User Authorization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub OAuth (user-to-server) authentication so users authorize the app before it acts on their behalf. Build a shared authorization module that every event handler uses to verify org membership, repo write access, and valid OAuth tokens.

**Architecture:** API Gateway adds `/auth/login` and `/auth/callback` routes. OAuth tokens stored in DynamoDB with KMS encryption. A shared `authorizeUser` module checks org membership + repo write access + valid token, used by all handler Lambdas. Depends on Plan A (WebhookIngestion construct) being deployed.

**Tech Stack:** AWS CDK (TypeScript), API Gateway, Lambda (Node.js 22), DynamoDB, KMS, GitHub OAuth

**Manual steps required:** Task 1 (GitHub App OAuth config) requires browser actions.

---

## File Structure

```
src/packages/app-framework/src/
  webhook/
    auth/
      oauthLogin.ts                  # Login sub-construct (Lambda)
      oauthLogin.handler.ts          # Login Lambda handler (auto-discovered)
      oauthLogin.handler.test.ts     # Unit tests for login handler
      oauthCallback.ts               # Callback sub-construct (Lambda)
      oauthCallback.handler.ts       # Callback Lambda handler (auto-discovered)
      oauthCallback.handler.test.ts  # Unit tests for callback handler
      authorizeUser.ts               # Shared authorization module
      authorizeUser.test.ts          # Unit tests for authorization
      tokenStore.ts                  # DynamoDB token CRUD operations
      tokenStore.test.ts             # Unit tests for token store
    index.ts                         # Modified: add OAuth routes + tables
    constants.ts                     # Modified: add OAuth env var names
```

---

### Task 1: Configure GitHub App for OAuth (MANUAL)

**Files:** None (browser actions)

- [ ] **Step 1: Enable OAuth on the GitHub App**

Go to: `github.com/organizations/sbalswa/settings/apps/ai3-mvp`

Set:
- **Callback URL**: `https://<your-api-gateway-url>/auth/callback` (use the API Gateway URL from Plan A deploy — you will update this after Task 6 deploy)
- **Request user authorization (OAuth) during installation**: Leave unchecked
- **Enable Device Flow**: Leave unchecked

- [ ] **Step 2: Note the Client ID and generate a Client Secret**

On the same page:
- **Client ID**: Already shown (e.g., `Iv23li6ndiRoICMS3xab`)
- Click **"Generate a new client secret"** — copy and save the secret value

- [ ] **Step 3: Store the Client Secret in AWS Secrets Manager**

Run:
```bash
AWS_PROFILE=burner2 aws secretsmanager create-secret \
  --name ai3-mvp/oauth-client-secret \
  --secret-string "<client-secret-from-step-2>" \
  --region us-east-1
```

Note the ARN from the output.

---

### Task 2: Token Store Module

**Files:**
- Create: `src/packages/app-framework/src/webhook/auth/tokenStore.ts`
- Test: `src/packages/app-framework/src/webhook/auth/tokenStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/packages/app-framework/src/webhook/auth/tokenStore.test.ts`:

```typescript
import { getToken, putToken, deleteToken } from './tokenStore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

jest.mock('@aws-sdk/client-dynamodb');

const mockSend = jest.fn();
(DynamoDBClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

describe('tokenStore', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.USER_TOKENS_TABLE_NAME = 'test-tokens-table';
  });

  it('getToken returns token data for existing user', async () => {
    mockSend.mockResolvedValue({
      Item: {
        GitHubUserId: { N: '12345' },
        Login: { S: 'testuser' },
        EncryptedAccessToken: { S: 'enc-access-token' },
        EncryptedRefreshToken: { S: 'enc-refresh-token' },
        TokenExpiry: { S: '2026-04-26T12:00:00Z' },
        Scopes: { S: 'repo,user' },
        LastUsed: { S: '2026-04-26T10:00:00Z' },
      },
    });
    const result = await getToken(12345);
    expect(result).toEqual({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'enc-access-token',
      encryptedRefreshToken: 'enc-refresh-token',
      tokenExpiry: '2026-04-26T12:00:00Z',
      scopes: 'repo,user',
      lastUsed: '2026-04-26T10:00:00Z',
    });
  });

  it('getToken returns null for non-existent user', async () => {
    mockSend.mockResolvedValue({ Item: undefined });
    const result = await getToken(99999);
    expect(result).toBeNull();
  });

  it('putToken stores token data', async () => {
    mockSend.mockResolvedValue({});
    await putToken({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'enc-access',
      encryptedRefreshToken: 'enc-refresh',
      tokenExpiry: '2026-04-26T12:00:00Z',
      scopes: 'repo',
      lastUsed: '2026-04-26T10:00:00Z',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const putCall = mockSend.mock.calls[0][0];
    expect(putCall.input.TableName).toBe('test-tokens-table');
    expect(putCall.input.Item.GitHubUserId.N).toBe('12345');
  });

  it('deleteToken removes token data', async () => {
    mockSend.mockResolvedValue({});
    await deleteToken(12345);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const deleteCall = mockSend.mock.calls[0][0];
    expect(deleteCall.input.Key.GitHubUserId.N).toBe('12345');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=tokenStore.test -v`
Expected: FAIL — `Cannot find module './tokenStore'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/auth/tokenStore.ts`:

```typescript
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

export interface UserToken {
  gitHubUserId: number;
  login: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  tokenExpiry: string;
  scopes: string;
  lastUsed: string;
}

function getTableName(): string {
  const name = process.env.USER_TOKENS_TABLE_NAME;
  if (!name) throw new Error('USER_TOKENS_TABLE_NAME not set');
  return name;
}

export async function getToken(gitHubUserId: number): Promise<UserToken | null> {
  const resp = await client.send(
    new GetItemCommand({
      TableName: getTableName(),
      Key: { GitHubUserId: { N: String(gitHubUserId) } },
    }),
  );
  if (!resp.Item) return null;
  return {
    gitHubUserId: Number(resp.Item.GitHubUserId.N),
    login: resp.Item.Login.S!,
    encryptedAccessToken: resp.Item.EncryptedAccessToken.S!,
    encryptedRefreshToken: resp.Item.EncryptedRefreshToken.S!,
    tokenExpiry: resp.Item.TokenExpiry.S!,
    scopes: resp.Item.Scopes.S!,
    lastUsed: resp.Item.LastUsed.S!,
  };
}

export async function putToken(token: UserToken): Promise<void> {
  await client.send(
    new PutItemCommand({
      TableName: getTableName(),
      Item: {
        GitHubUserId: { N: String(token.gitHubUserId) },
        Login: { S: token.login },
        EncryptedAccessToken: { S: token.encryptedAccessToken },
        EncryptedRefreshToken: { S: token.encryptedRefreshToken },
        TokenExpiry: { S: token.tokenExpiry },
        Scopes: { S: token.scopes },
        LastUsed: { S: token.lastUsed },
      },
    }),
  );
}

export async function deleteToken(gitHubUserId: number): Promise<void> {
  await client.send(
    new DeleteItemCommand({
      TableName: getTableName(),
      Key: { GitHubUserId: { N: String(gitHubUserId) } },
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=tokenStore.test -v`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/auth/tokenStore.ts src/packages/app-framework/src/webhook/auth/tokenStore.test.ts
git commit -m "feat(oauth): add DynamoDB token store module"
```

---

### Task 3: Authorization Module

**Files:**
- Create: `src/packages/app-framework/src/webhook/auth/authorizeUser.ts`
- Test: `src/packages/app-framework/src/webhook/auth/authorizeUser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/packages/app-framework/src/webhook/auth/authorizeUser.test.ts`:

```typescript
import { authorizeUser, AuthResult } from './authorizeUser';

const mockGetToken = jest.fn();
jest.mock('./tokenStore', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('authorizeUser', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockFetch.mockReset();
  });

  it('rejects user not in sbalswa org', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404 });
    const result = await authorizeUser({
      senderLogin: 'outsider',
      senderId: 99999,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('not a member');
  });

  it('rejects user without repo write access', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'read' }),
      });
    const result = await authorizeUser({
      senderLogin: 'reader',
      senderId: 11111,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('write access');
  });

  it('returns needsAuth when user has no OAuth token', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'write' }),
      });
    mockGetToken.mockResolvedValue(null);
    const result = await authorizeUser({
      senderLogin: 'newuser',
      senderId: 22222,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.needsAuth).toBe(true);
  });

  it('authorizes user with valid token and permissions', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'admin' }),
      });
    mockGetToken.mockResolvedValue({
      gitHubUserId: 33333,
      login: 'admin-user',
      encryptedAccessToken: 'enc-token',
      encryptedRefreshToken: 'enc-refresh',
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      scopes: 'repo',
      lastUsed: new Date().toISOString(),
    });
    const result = await authorizeUser({
      senderLogin: 'admin-user',
      senderId: 33333,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(true);
    expect(result.userToken).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=authorizeUser.test -v`
Expected: FAIL — `Cannot find module './authorizeUser'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/auth/authorizeUser.ts`:

```typescript
import { getToken } from './tokenStore';

export interface AuthorizeInput {
  senderLogin: string;
  senderId: number;
  repoFullName: string;
  installationToken: string;
  orgName: string;
}

export interface AuthResult {
  authorized: boolean;
  reason?: string;
  needsAuth?: boolean;
  userToken?: {
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiry: string;
  };
}

const WRITE_PERMISSIONS = new Set(['write', 'admin', 'maintain']);

export async function authorizeUser(input: AuthorizeInput): Promise<AuthResult> {
  const orgCheckResp = await fetch(
    `https://api.github.com/orgs/${input.orgName}/members/${input.senderLogin}`,
    {
      headers: {
        Authorization: `Bearer ${input.installationToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (orgCheckResp.status !== 204) {
    return {
      authorized: false,
      reason: `${input.senderLogin} is not a member of ${input.orgName}`,
    };
  }

  const permResp = await fetch(
    `https://api.github.com/repos/${input.repoFullName}/collaborators/${input.senderLogin}/permission`,
    {
      headers: {
        Authorization: `Bearer ${input.installationToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (!permResp.ok) {
    return {
      authorized: false,
      reason: `Failed to check permissions for ${input.senderLogin} on ${input.repoFullName}`,
    };
  }
  const permData = (await permResp.json()) as { permission: string };
  if (!WRITE_PERMISSIONS.has(permData.permission)) {
    return {
      authorized: false,
      reason: `${input.senderLogin} does not have write access to ${input.repoFullName}`,
    };
  }

  const token = await getToken(input.senderId);
  if (!token) {
    return { authorized: false, needsAuth: true };
  }

  return {
    authorized: true,
    userToken: {
      encryptedAccessToken: token.encryptedAccessToken,
      encryptedRefreshToken: token.encryptedRefreshToken,
      tokenExpiry: token.tokenExpiry,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=authorizeUser.test -v`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework/src/webhook/auth/authorizeUser.ts src/packages/app-framework/src/webhook/auth/authorizeUser.test.ts
git commit -m "feat(oauth): add shared user authorization module"
```

---

### Task 4: OAuth Login Lambda Handler

**Files:**
- Create: `src/packages/app-framework/src/webhook/auth/oauthLogin.handler.ts`
- Test: `src/packages/app-framework/src/webhook/auth/oauthLogin.handler.test.ts`
- Create: `src/packages/app-framework/src/webhook/auth/oauthLogin.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/auth/oauthLogin.handler.test.ts`:

```typescript
import { handler } from './oauthLogin.handler';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('a'.repeat(32))),
}));

describe('oauthLogin handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    process.env.AUTH_STATE_TABLE_NAME = 'test-auth-state';
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CALLBACK_URL = 'https://api.example.com/auth/callback';
  });

  it('redirects to GitHub OAuth with state parameter', async () => {
    const event = {
      queryStringParameters: {
        repo: 'sbalswa/test-repo',
        issue: '42',
      },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(302);
    expect(result.headers?.Location).toContain('github.com/login/oauth/authorize');
    expect(result.headers?.Location).toContain('client_id=test-client-id');
    expect(result.headers?.Location).toContain('state=');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=oauthLogin.handler.test -v`
Expected: FAIL — `Cannot find module './oauthLogin.handler'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/auth/oauthLogin.handler.ts`:

```typescript
import { randomBytes } from 'crypto';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const dynamoClient = new DynamoDBClient({});

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const callbackUrl = process.env.OAUTH_CALLBACK_URL;
  const tableName = process.env.AUTH_STATE_TABLE_NAME;

  if (!clientId || !callbackUrl || !tableName) {
    return { statusCode: 500, body: 'Server configuration error' };
  }

  const state = randomBytes(32).toString('hex');
  const repo = event.queryStringParameters?.repo || '';
  const issue = event.queryStringParameters?.issue || '';

  const ttl = Math.floor(Date.now() / 1000) + 600;

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        StateNonce: { S: state },
        Repo: { S: repo },
        Issue: { S: issue },
        TTL: { N: String(ttl) },
      },
    }),
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    state,
    scope: '',
  });

  return {
    statusCode: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
    },
    body: '',
  };
};
```

- [ ] **Step 4: Write the login sub-construct**

Create `src/packages/app-framework/src/webhook/auth/oauthLogin.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface OAuthLoginProps {
  readonly authStateTable: Table;
  readonly gitHubClientId: string;
  readonly oauthCallbackUrl: string;
}

export class OAuthLogin extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: OAuthLoginProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Generates OAuth state and redirects to GitHub authorization',
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: {
        AUTH_STATE_TABLE_NAME: props.authStateTable.tableName,
        GITHUB_CLIENT_ID: props.gitHubClientId,
        OAUTH_CALLBACK_URL: props.oauthCallbackUrl,
      },
    });

    props.authStateTable.grantWriteData(this.lambdaHandler);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=oauthLogin.handler.test -v`
Expected: 1 test PASS

- [ ] **Step 6: Commit**

```bash
git add src/packages/app-framework/src/webhook/auth/oauthLogin.handler.ts src/packages/app-framework/src/webhook/auth/oauthLogin.handler.test.ts src/packages/app-framework/src/webhook/auth/oauthLogin.ts
git commit -m "feat(oauth): add OAuth login Lambda with state nonce"
```

---

### Task 5: OAuth Callback Lambda Handler

**Files:**
- Create: `src/packages/app-framework/src/webhook/auth/oauthCallback.handler.ts`
- Test: `src/packages/app-framework/src/webhook/auth/oauthCallback.handler.test.ts`
- Create: `src/packages/app-framework/src/webhook/auth/oauthCallback.ts`

- [ ] **Step 1: Write the failing test**

Create `src/packages/app-framework/src/webhook/auth/oauthCallback.handler.test.ts`:

```typescript
import { handler } from './oauthCallback.handler';

const mockDynamoSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  GetItemCommand: jest.fn().mockImplementation((input) => ({ input, kind: 'get' })),
  DeleteItemCommand: jest.fn().mockImplementation((input) => ({ input, kind: 'delete' })),
}));

const mockPutToken = jest.fn();
jest.mock('./tokenStore', () => ({
  putToken: (...args: unknown[]) => mockPutToken(...args),
}));

const mockSecretsManagerSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({ send: mockSecretsManagerSend })),
  GetSecretValueCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('oauthCallback handler', () => {
  beforeEach(() => {
    mockDynamoSend.mockReset();
    mockPutToken.mockReset();
    mockSecretsManagerSend.mockReset();
    mockFetch.mockReset();
    process.env.AUTH_STATE_TABLE_NAME = 'test-auth-state';
    process.env.USER_TOKENS_TABLE_NAME = 'test-tokens';
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:test';
  });

  it('rejects request with invalid state', async () => {
    mockDynamoSend.mockResolvedValue({ Item: undefined });
    const event = {
      queryStringParameters: { code: 'test-code', state: 'bad-state' },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid state');
  });

  it('exchanges code for token and stores it', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({
        Item: {
          StateNonce: { S: 'valid-state' },
          Repo: { S: 'sbalswa/test' },
          Issue: { S: '42' },
        },
      })
      .mockResolvedValueOnce({});

    mockSecretsManagerSend.mockResolvedValue({ SecretString: 'test-client-secret' });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ghu_testtoken',
          refresh_token: 'ghr_testrefresh',
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          scope: '',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 12345, login: 'testuser' }),
      });

    mockPutToken.mockResolvedValue(undefined);

    const event = {
      queryStringParameters: { code: 'test-code', state: 'valid-state' },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('authorized');
    expect(mockPutToken).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=oauthCallback.handler.test -v`
Expected: FAIL — `Cannot find module './oauthCallback.handler'`

- [ ] **Step 3: Write the implementation**

Create `src/packages/app-framework/src/webhook/auth/oauthCallback.handler.ts`:

```typescript
import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { putToken } from './tokenStore';

const dynamoClient = new DynamoDBClient({});
const secretsClient = new SecretsManagerClient({});

let cachedClientSecret: string | undefined;

async function getClientSecret(): Promise<string> {
  if (cachedClientSecret) return cachedClientSecret;
  const arn = process.env.OAUTH_CLIENT_SECRET_ARN;
  if (!arn) throw new Error('OAUTH_CLIENT_SECRET_ARN not set');
  const resp = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  cachedClientSecret = resp.SecretString;
  if (!cachedClientSecret) throw new Error('Client secret is empty');
  return cachedClientSecret;
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const code = event.queryStringParameters?.code;
  const state = event.queryStringParameters?.state;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const authStateTable = process.env.AUTH_STATE_TABLE_NAME;
  const userTokensTable = process.env.USER_TOKENS_TABLE_NAME;

  if (!code || !state || !clientId || !authStateTable || !userTokensTable) {
    return { statusCode: 400, body: 'Missing required parameters' };
  }

  const stateResp = await dynamoClient.send(
    new GetItemCommand({
      TableName: authStateTable,
      Key: { StateNonce: { S: state } },
    }),
  );
  if (!stateResp.Item) {
    return { statusCode: 400, body: 'Invalid state parameter — it may have expired' };
  }

  await dynamoClient.send(
    new DeleteItemCommand({
      TableName: authStateTable,
      Key: { StateNonce: { S: state } },
    }),
  );

  const clientSecret = await getClientSecret();

  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenResp.ok) {
    return { statusCode: 502, body: 'Failed to exchange code for token' };
  }

  const tokenData = (await tokenResp.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  const userResp = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!userResp.ok) {
    return { statusCode: 502, body: 'Failed to get user info' };
  }
  const userData = (await userResp.json()) as { id: number; login: string };

  const expiresAt = new Date(
    Date.now() + tokenData.expires_in * 1000,
  ).toISOString();

  await putToken({
    gitHubUserId: userData.id,
    login: userData.login,
    encryptedAccessToken: tokenData.access_token,
    encryptedRefreshToken: tokenData.refresh_token,
    tokenExpiry: expiresAt,
    scopes: tokenData.scope || '',
    lastUsed: new Date().toISOString(),
  });

  console.log('OAuth token stored', { userId: userData.id, login: userData.login });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: '<html><body><h1>Authorized!</h1><p>You can close this tab and return to GitHub.</p></body></html>',
  };
};
```

- [ ] **Step 4: Write the callback sub-construct**

Create `src/packages/app-framework/src/webhook/auth/oauthCallback.ts`:

```typescript
import { Duration } from 'aws-cdk-lib';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { ISecret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { LAMBDA_DEFAULTS } from '../../lambdaDefaults';

export interface OAuthCallbackProps {
  readonly authStateTable: Table;
  readonly userTokensTable: Table;
  readonly gitHubClientId: string;
  readonly oauthClientSecret: ISecret;
  readonly oauthClientSecretArn: string;
}

export class OAuthCallback extends Construct {
  readonly lambdaHandler: NodejsFunction;

  constructor(scope: Construct, id: string, props: OAuthCallbackProps) {
    super(scope, id);

    this.lambdaHandler = new NodejsFunction(this, 'handler', {
      ...LAMBDA_DEFAULTS,
      description: 'Handles GitHub OAuth callback, exchanges code for token',
      memorySize: 256,
      timeout: Duration.seconds(30),
      environment: {
        AUTH_STATE_TABLE_NAME: props.authStateTable.tableName,
        USER_TOKENS_TABLE_NAME: props.userTokensTable.tableName,
        GITHUB_CLIENT_ID: props.gitHubClientId,
        OAUTH_CLIENT_SECRET_ARN: props.oauthClientSecretArn,
      },
    });

    props.authStateTable.grantReadWriteData(this.lambdaHandler);
    props.userTokensTable.grantWriteData(this.lambdaHandler);
    props.oauthClientSecret.grantRead(this.lambdaHandler);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src/packages/app-framework && npx jest --testPathPattern=oauthCallback.handler.test -v`
Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/packages/app-framework/src/webhook/auth/oauthCallback.handler.ts src/packages/app-framework/src/webhook/auth/oauthCallback.handler.test.ts src/packages/app-framework/src/webhook/auth/oauthCallback.ts
git commit -m "feat(oauth): add OAuth callback Lambda with token exchange"
```

---

### Task 6: Update WebhookIngestion Construct with OAuth

**Files:**
- Modify: `src/packages/app-framework/src/webhook/index.ts`
- Modify: `src/packages/app-framework/src/webhook/constants.ts`

- [ ] **Step 1: Update constants**

Add to `src/packages/app-framework/src/webhook/constants.ts`:

```typescript
export const OAuthEnvironmentVariables = {
  AUTH_STATE_TABLE_NAME: 'AUTH_STATE_TABLE_NAME',
  USER_TOKENS_TABLE_NAME: 'USER_TOKENS_TABLE_NAME',
  GITHUB_CLIENT_ID: 'GITHUB_CLIENT_ID',
  OAUTH_CALLBACK_URL: 'OAUTH_CALLBACK_URL',
  OAUTH_CLIENT_SECRET_ARN: 'OAUTH_CLIENT_SECRET_ARN',
} as const;
```

- [ ] **Step 2: Update WebhookIngestion props and construct**

Modify `src/packages/app-framework/src/webhook/index.ts`:

Add to `WebhookIngestionProps`:
```typescript
export interface WebhookIngestionProps {
  readonly webhookSecretArn: string;
  readonly gitHubClientId?: string;
  readonly oauthClientSecretArn?: string;
}
```

Add new imports at the top:
```typescript
import { OAuthLogin } from './auth/oauthLogin';
import { OAuthCallback } from './auth/oauthCallback';
```

Inside the constructor, after the WAF association and before the stub handler, add:

```typescript
    // OAuth tables and routes (only if OAuth is configured)
    if (props.gitHubClientId && props.oauthClientSecretArn) {
      const oauthClientSecret = Secret.fromSecretCompleteArn(
        this,
        'OAuthClientSecret',
        props.oauthClientSecretArn,
      );

      const authStateTable = new Table(this, 'AuthStateTable', {
        partitionKey: { name: 'StateNonce', type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'TTL',
      });

      this.userTokensTable = new Table(this, 'UserTokensTable', {
        partitionKey: { name: 'GitHubUserId', type: AttributeType.NUMBER },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.RETAIN,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      });

      const callbackUrl = api.urlForPath('/auth/callback');

      const login = new OAuthLogin(this, 'OAuthLogin', {
        authStateTable,
        gitHubClientId: props.gitHubClientId,
        oauthCallbackUrl: callbackUrl,
      });

      const callback = new OAuthCallback(this, 'OAuthCallback', {
        authStateTable,
        userTokensTable: this.userTokensTable,
        gitHubClientId: props.gitHubClientId,
        oauthClientSecret,
        oauthClientSecretArn: props.oauthClientSecretArn,
      });

      const authResource = api.root.addResource('auth');
      authResource
        .addResource('login')
        .addMethod('GET', new LambdaIntegration(login.lambdaHandler));
      authResource
        .addResource('callback')
        .addMethod('GET', new LambdaIntegration(callback.lambdaHandler));
    }
```

Add `userTokensTable` as a class property:
```typescript
  readonly userTokensTable?: Table;
```

- [ ] **Step 3: Commit**

```bash
git add src/packages/app-framework/src/webhook/index.ts src/packages/app-framework/src/webhook/constants.ts
git commit -m "feat(oauth): add OAuth routes and tables to WebhookIngestion construct"
```

---

### Task 7: Update Test App and Deploy

**Files:**
- Modify: `src/packages/app-framework-test-app/src/main.ts`

- [ ] **Step 1: Update test app to pass OAuth config**

Modify the `WebhookIngestion` instantiation in `main.ts` to include OAuth props:

```typescript
    const webhookSecretArn = this.node.tryGetContext('webhookSecretArn') as string;
    const gitHubClientId = this.node.tryGetContext('gitHubClientId') as string;
    const oauthClientSecretArn = this.node.tryGetContext('oauthClientSecretArn') as string;
    if (webhookSecretArn) {
      const webhook = new WebhookIngestion(this, 'WebhookIngestion', {
        webhookSecretArn,
        gitHubClientId,
        oauthClientSecretArn,
      });
      new CfnOutput(this, 'WebhookEndpoint', {
        value: webhook.apiEndpoint,
        exportName: 'WebhookEndpoint',
      });
    }
```

- [ ] **Step 2: Build**

Run: `npx projen build`
Expected: All tests pass, compilation succeeds.

- [ ] **Step 3: Deploy**

Run (replace ARNs with actual values):
```bash
cd src/packages/app-framework-test-app && \
AWS_PROFILE=burner2 npx cdk deploy the-app-framework-test-stack \
  --context webhookSecretArn=<webhook-secret-arn> \
  --context gitHubClientId=Iv23li6ndiRoICMS3xab \
  --context oauthClientSecretArn=<oauth-client-secret-arn> \
  --outputs-file /tmp/cdk-output.json \
  --require-approval never
```

- [ ] **Step 4: Update GitHub App callback URL (MANUAL)**

Go to `github.com/organizations/sbalswa/settings/apps/ai3-mvp` and set:
- **Callback URL**: `https://<api-gateway-url>/auth/callback`

- [ ] **Step 5: Commit**

```bash
git add src/packages/app-framework-test-app/src/main.ts
git commit -m "feat(test-app): add OAuth config to WebhookIngestion"
```

---

### Task 8: End-to-End OAuth Verification (MANUAL)

**Files:** None (browser verification)

- [ ] **Step 1: Test the login flow**

Open in a browser:
```
https://<api-gateway-url>/auth/login?repo=sbalswa/test-repo&issue=1
```

Expected: Redirects to GitHub's OAuth authorization page. After authorizing, redirects back to the callback URL and shows "Authorized!"

- [ ] **Step 2: Verify token was stored**

Run:
```bash
AWS_PROFILE=burner2 aws dynamodb scan \
  --table-name <UserTokensTable-name> \
  --region us-east-1 \
  --query 'Items[0].{UserId:GitHubUserId.N,Login:Login.S,Expiry:TokenExpiry.S}'
```

Expected: Shows your GitHub user ID, login, and a token expiry ~8 hours in the future.

---

## Summary

After completing this plan you will have:
- GitHub OAuth login/callback flow via API Gateway
- UserTokens DynamoDB table with token storage
- AuthState DynamoDB table with CSRF-preventing nonces
- Shared `authorizeUser` module checking org membership + repo write + valid token
- Ready for Plan C (Orchestration) to add real event handlers that use auth
