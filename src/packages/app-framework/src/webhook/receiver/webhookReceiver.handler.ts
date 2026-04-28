import {
  DynamoDBClient,
  PutItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
// eslint-disable-next-line import/no-extraneous-dependencies
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  WebhookEnvironmentVariables,
  EVENTBRIDGE_MAX_DETAIL_BYTES,
} from '../constants';
import { verifySignature } from './verifySignature';

const secretsClient = new SecretsManagerClient({});
const eventBridgeClient = new EventBridgeClient({});
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

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

async function storePayloadInS3(
  bucket: string,
  deliveryId: string,
  eventType: string,
  body: string,
): Promise<{ bucket: string; key: string }> {
  const now = new Date();
  const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}`;
  const key = `webhooks/${datePath}/${eventType}/${deliveryId}.json`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  return { bucket, key };
}

export const handler = async (
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> => {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(event.headers)) {
    headers[key.toLowerCase()] = value;
  }

  const signature = headers['x-hub-signature-256'] || '';
  const deliveryId = headers['x-github-delivery'] || '';
  const eventType = headers['x-github-event'] || '';
  const body = event.body || '';

  if (!deliveryId || !eventType) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'error', reason: 'missing_headers' }),
    };
  }

  const secret = await getWebhookSecret();
  if (!verifySignature(body, signature, secret)) {
    console.error('Webhook signature verification failed', { deliveryId });
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'error',
        reason: 'invalid_signature',
        deliveryId,
      }),
    };
  }

  const isNew = await checkIdempotency(deliveryId);
  if (!isNew) {
    console.log('Duplicate delivery, skipping', { deliveryId });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'duplicate', deliveryId }),
    };
  }

  const busName = process.env[WebhookEnvironmentVariables.EVENT_BUS_NAME];
  if (!busName) throw new Error('EVENT_BUS_NAME not set');
  const bucketName =
    process.env[WebhookEnvironmentVariables.PAYLOAD_BUCKET_NAME];
  if (!bucketName) throw new Error('PAYLOAD_BUCKET_NAME not set');

  const payload = JSON.parse(body);

  const s3Ref = await storePayloadInS3(bucketName, deliveryId, eventType, body);

  const detail: Record<string, unknown> = {
    delivery_id: deliveryId,
    action: payload.action,
    sender: payload.sender,
    repository: payload.repository,
    organization: payload.organization,
    installation: payload.installation,
    s3_reference: s3Ref,
    payload_complete: false,
  };

  const detailWithPayload = { ...detail, payload, payload_complete: true };
  const detailJson = JSON.stringify(detailWithPayload);

  if (Buffer.byteLength(detailJson, 'utf8') <= EVENTBRIDGE_MAX_DETAIL_BYTES) {
    detail.payload = payload;
    detail.payload_complete = true;
  }

  await eventBridgeClient.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: 'github',
          DetailType: eventType,
          Detail: JSON.stringify(detail),
          EventBusName: busName,
        },
      ],
    }),
  );

  console.log('Event dispatched', {
    deliveryId,
    eventType,
    payloadComplete: detail.payload_complete,
    s3Key: s3Ref.key,
  });
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ok', deliveryId, eventType }),
  };
};
