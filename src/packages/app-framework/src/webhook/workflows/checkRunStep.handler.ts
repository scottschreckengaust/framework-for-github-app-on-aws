export const handler = async (event: {
  action: 'create' | 'complete';
  userId?: number;
  owner: string;
  repo: string;
  headSha?: string;
  checkRunId?: number;
  jobId: string;
}): Promise<{ checkRunId: number; jobId: string }> => {
  const token = await getToken(event.userId);
  if (!token) throw new Error('No token available (user or installation)');

  if (event.action === 'create') {
    const resp = await fetch(
      `https://api.github.com/repos/${event.owner}/${event.repo}/check-runs`,
      {
        method: 'POST',
        // prettier-ignore
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ai3-mvp / CI Check',
          head_sha: event.headSha,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to create check run: ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as { id: number };
    console.log('Check run created', {
      checkRunId: data.id,
      jobId: event.jobId,
    });
    return { checkRunId: data.id, jobId: event.jobId };
  }

  if (event.action === 'complete') {
    const resp = await fetch(
      `https://api.github.com/repos/${event.owner}/${event.repo}/check-runs/${event.checkRunId}`,
      {
        method: 'PATCH',
        // prettier-ignore
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'completed',
          conclusion: 'success',
          completed_at: new Date().toISOString(),
          output: {
            title: 'CI Check Passed',
            summary: 'All checks completed successfully.',
          },
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to complete check run: ${resp.status} ${text}`);
    }
    console.log('Check run completed', {
      checkRunId: event.checkRunId,
      jobId: event.jobId,
    });
    return { checkRunId: event.checkRunId!, jobId: event.jobId };
  }

  throw new Error(`Unknown action: ${event.action}`);
};

async function getToken(userId?: number): Promise<string | null> {
  // Try user token first
  if (userId) {
    const userToken = await getUserToken(userId);
    if (userToken) {
      console.log('Using user token', { userId });
      return userToken;
    }
    console.log('User token unavailable, falling back to installation token', {
      userId,
    });
  }
  // Fallback to installation token
  return getInstallationToken();
}

async function getUserToken(userId: number): Promise<string | null> {
  const tableName = process.env.USER_TOKENS_TABLE_NAME;
  const keyArn = process.env.TOKEN_ENCRYPTION_KEY_ARN;
  if (!tableName) return null;

  try {
    /* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
    const { DynamoDBClient, GetItemCommand } = await import(
      '@aws-sdk/client-dynamodb'
    );
    /* eslint-enable import/no-unresolved, import/no-extraneous-dependencies */
    const ddb = new DynamoDBClient({});
    const resp = await ddb.send(
      new GetItemCommand({
        TableName: tableName,
        Key: { GitHubUserId: { N: String(userId) } },
      }),
    );
    if (!resp.Item) return null;

    const encryptedToken = resp.Item.EncryptedAccessToken?.S;
    const tokenExpiry = resp.Item.TokenExpiry?.S;
    if (!encryptedToken || !tokenExpiry) return null;

    // Check if expired
    if (new Date(tokenExpiry).getTime() < Date.now()) {
      console.log('User token expired', { userId, expiry: tokenExpiry });
      return null;
    }

    // Decrypt
    if (keyArn) {
      /* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
      const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
      /* eslint-enable import/no-unresolved, import/no-extraneous-dependencies */
      const kms = new KMSClient({});
      const decResp = await kms.send(
        new DecryptCommand({
          CiphertextBlob: Buffer.from(encryptedToken, 'base64'),
        }),
      );
      return Buffer.from(decResp.Plaintext!).toString('utf8');
    }

    // No KMS key configured, token may be plaintext
    return encryptedToken;
  } catch (e) {
    console.error('Failed to get user token', { userId, error: e });
    return null;
  }
}

async function getInstallationToken(): Promise<string | null> {
  const functionName = process.env.INSTALLATION_TOKEN_FUNCTION_NAME;
  const appId = process.env.APP_ID;
  const nodeId = process.env.NODE_ID;
  if (!functionName || !appId || !nodeId) return null;

  try {
    /* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
    const { LambdaClient, InvokeCommand } = await import(
      '@aws-sdk/client-lambda'
    );
    /* eslint-enable import/no-unresolved, import/no-extraneous-dependencies */
    const lambda = new LambdaClient({});
    const accountId =
      (process.env.AWS_LAMBDA_FUNCTION_ARN || '').split(':')[4] || 'unknown';
    const event = {
      version: '2.0',
      routeKey: 'POST /tokens/installation',
      rawPath: '/tokens/installation',
      headers: { 'content-type': 'application/json' },
      requestContext: {
        http: { method: 'POST', path: '/tokens/installation' },
        accountId,
        stage: '$default',
        requestId: 'internal',
        authorizer: {
          iam: {
            accessKey: 'internal',
            accountId,
            userArn: process.env.AWS_LAMBDA_FUNCTION_ARN || 'unknown',
          },
        },
      },
      body: JSON.stringify({ appId: Number(appId), nodeId }),
      isBase64Encoded: false,
    };
    const resp = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(event),
      }),
    );
    const respPayload = JSON.parse(new TextDecoder().decode(resp.Payload));
    if (respPayload.statusCode !== 200) return null;
    const body = JSON.parse(respPayload.body);
    return body.installationToken || null;
  } catch (e) {
    console.error('Failed to get installation token', e);
    return null;
  }
}
