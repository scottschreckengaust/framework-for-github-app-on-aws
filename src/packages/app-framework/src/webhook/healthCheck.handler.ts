import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

export const handler = async (): Promise<void> => {
  const functionName = process.env.APP_TOKEN_FUNCTION_NAME;
  const appId = process.env.APP_ID;

  if (!functionName || !appId) {
    console.error('Health check misconfigured', { functionName, appId });
    await publishHealthMetric(0);
    return;
  }

  try {
    // Step 1: Get App Token from Credential Manager
    // eslint-disable-next-line import/no-extraneous-dependencies
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
    const lambda = new LambdaClient({});

    const event = {
      version: '2.0',
      routeKey: 'POST /tokens/app',
      rawPath: '/tokens/app',
      headers: { 'content-type': 'application/json' },
      requestContext: {
        http: { method: 'POST', path: '/tokens/app' },
        accountId: '361116840407',
        stage: '$default',
        requestId: 'health-check',
        authorizer: { iam: { accessKey: 'internal', accountId: '361116840407', userArn: 'internal' } },
      },
      body: JSON.stringify({ appId: Number(appId) }),
      isBase64Encoded: false,
    };

    const resp = await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(event),
    }));

    const respPayload = JSON.parse(new TextDecoder().decode(resp.Payload));
    if (respPayload.statusCode !== 200) {
      console.error('App token request failed', respPayload);
      await publishHealthMetric(0);
      return;
    }

    const body = JSON.parse(respPayload.body);
    const appToken = body.appToken;

    if (!appToken) {
      console.error('No app token in response');
      await publishHealthMetric(0);
      return;
    }

    // Step 2: Call GitHub API to verify connectivity
    const ghResp = await fetch('https://api.github.com/app', {
      headers: {
        Authorization: `Bearer ${appToken}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (ghResp.ok) {
      const appData = await ghResp.json() as { name: string };
      console.log('Health check passed', { app: appData.name });
      await publishHealthMetric(1);
    } else {
      console.error('GitHub API check failed', { status: ghResp.status });
      await publishHealthMetric(0);
    }
  } catch (error) {
    console.error('Health check error', error);
    await publishHealthMetric(0);
  }
};

async function publishHealthMetric(value: number): Promise<void> {
  const metrics = new Metrics({ namespace: 'GitHubAppPlatform', serviceName: 'healthCheck' });
  metrics.addDimension('AppId', process.env.APP_ID || 'unknown');
  metrics.addDimension('CheckType', 'GitHubConnectivity');
  metrics.addMetric('HealthCheckSuccess', MetricUnit.Count, value);
  metrics.publishStoredMetrics();
}
