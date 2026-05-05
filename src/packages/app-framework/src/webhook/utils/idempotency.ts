import {
  DynamoDBClient,
  PutItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});

export async function isAlreadyProcessed(
  deliveryId: string,
  handlerName: string,
): Promise<boolean> {
  const tableName = process.env.JOBS_TABLE_NAME;
  if (!tableName) {
    console.warn('JOBS_TABLE_NAME not set, skipping idempotency check');
    return false;
  }

  try {
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          JobId: { S: `delivery:${handlerName}:${deliveryId}` },
          DeliveryId: { S: deliveryId },
          HandlerName: { S: handlerName },
          ProcessedAt: { S: new Date().toISOString() },
          Status: { S: 'PROCESSED' },
          RepoFullName: { S: 'N/A' },
          UserId: { N: '0' },
          CreatedAt: { S: new Date().toISOString() },
        },
        ConditionExpression: 'attribute_not_exists(JobId)',
      }),
    );
    return false;
  } catch (e) {
    if (e instanceof ConditionalCheckFailedException) {
      console.log('Duplicate delivery at handler level', {
        deliveryId,
        handlerName,
      });
      return true;
    }
    throw e;
  }
}
