import {
  DynamoDBClient,
  PutItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
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
