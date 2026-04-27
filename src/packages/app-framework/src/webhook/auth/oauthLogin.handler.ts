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
