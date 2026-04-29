import { DynamoDBClient, DeleteItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';

export async function redrive(deliveryId: string, tableName: string): Promise<void> {
  const client = new DynamoDBClient({});

  const existing = await client.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { DeliveryId: { S: deliveryId } },
    }),
  );

  if (!existing.Item) {
    console.log(`No idempotency record found for delivery ${deliveryId}`);
    console.log('The event may have already expired (24h TTL) or was never processed.');
    console.log('You can redeliver directly from GitHub without clearing the record.');
    return;
  }

  await client.send(
    new DeleteItemCommand({
      TableName: tableName,
      Key: { DeliveryId: { S: deliveryId } },
    }),
  );

  console.log(`Idempotency record deleted for delivery: ${deliveryId}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Go to your GitHub App settings > Advanced > Recent Deliveries');
  console.log('  2. Find the delivery and click "Redeliver"');
  console.log('  3. The webhook will be processed as a new event');
}
