export const handler = async (event: {
  action: 'create' | 'complete';
  userId?: number;
  owner: string;
  repo: string;
  headSha?: string;
  checkRunId?: number;
  jobId: string;
}): Promise<{ checkRunId: number; jobId: string }> => {
  // Get installation token for GitHub API calls (not user token)
  // The check run is created by the app, not the user
  const token = await getInstallationToken();
  if (!token) throw new Error('Failed to get installation token');

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
    console.log('Check run created', { checkRunId: data.id, jobId: event.jobId });
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
    console.log('Check run completed', { checkRunId: event.checkRunId, jobId: event.jobId });
    return { checkRunId: event.checkRunId!, jobId: event.jobId };
  }

  throw new Error(`Unknown action: ${event.action}`);
};

async function getInstallationToken(): Promise<string | null> {
  const functionName = process.env.INSTALLATION_TOKEN_FUNCTION_NAME;
  const appId = process.env.APP_ID;
  const nodeId = process.env.NODE_ID;
  if (!functionName || !appId || !nodeId) return null;

  try {
    /* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    /* eslint-enable import/no-unresolved, import/no-extraneous-dependencies */
    const lambda = new LambdaClient({});
    const event = {
      version: '2.0',
      routeKey: 'POST /tokens/installation',
      rawPath: '/tokens/installation',
      headers: { 'content-type': 'application/json' },
      requestContext: {
        http: { method: 'POST', path: '/tokens/installation' },
        accountId: process.env.AWS_ACCOUNT_ID || '000000000000',
        stage: '$default',
        requestId: 'step-function-check',
        authorizer: { iam: { accessKey: 'internal', accountId: process.env.AWS_ACCOUNT_ID || '000000000000', userArn: 'internal' } },
      },
      body: JSON.stringify({ appId: Number(appId), nodeId }),
      isBase64Encoded: false,
    };
    const resp = await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(event),
    }));
    const respPayload = JSON.parse(new TextDecoder().decode(resp.Payload));
    if (respPayload.statusCode !== 200) return null;
    const body = JSON.parse(respPayload.body);
    return body.installationToken || null;
  } catch (e) {
    console.error('Failed to get installation token', e);
    return null;
  }
}
