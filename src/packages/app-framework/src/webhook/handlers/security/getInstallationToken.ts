export async function getInstallationToken(): Promise<string | null> {
  const appId = process.env.APP_ID;
  const functionName = process.env.INSTALLATION_TOKEN_FUNCTION_NAME;
  const nodeId = process.env.NODE_ID;
  if (!appId || !functionName || !nodeId) return null;

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
    if (respPayload.statusCode !== 200) {
      console.error('Installation token error', {
        statusCode: respPayload?.statusCode,
      });
      return null;
    }
    const body = JSON.parse(respPayload.body);
    return body.installationToken || null;
  } catch (e) {
    console.error('Failed to get installation token', e);
    return null;
  }
}
