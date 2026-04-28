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
    return {
      statusCode: 400,
      body: 'Invalid state parameter — it may have expired',
    };
  }

  await dynamoClient.send(
    new DeleteItemCommand({
      TableName: authStateTable,
      Key: { StateNonce: { S: state } },
    }),
  );

  const clientSecret = await getClientSecret();

  const tokenResp = await fetch(
    'https://github.com/login/oauth/access_token',
    {
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
    },
  );

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

  console.log('OAuth token stored', {
    userId: userData.id,
    login: userData.login,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: '<html><body><h1>Authorized!</h1><p>You can close this tab and return to GitHub.</p></body></html>',
  };
};
