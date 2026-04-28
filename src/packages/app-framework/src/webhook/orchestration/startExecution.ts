import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { DynamoDBClient, PutItemCommand, AttributeValue } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';

const sfnClient = new SFNClient({});
const dynamoClient = new DynamoDBClient({});

export interface StartExecutionInput {
  stateMachineArn: string;
  input: Record<string, unknown>;
  userId: number;
  repoFullName: string;
  checkRunId?: number;
}

export interface StartExecutionResult {
  jobId: string;
  executionArn: string;
}

export async function startExecution(
  params: StartExecutionInput,
): Promise<StartExecutionResult> {
  const jobId = randomUUID();
  const now = new Date().toISOString();

  const sfnResp = await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: params.stateMachineArn,
      name: jobId,
      input: JSON.stringify({
        ...params.input,
        jobId,
      }),
    }),
  );

  const executionArn = sfnResp.executionArn!;

  const tableName = process.env.JOBS_TABLE_NAME;
  if (!tableName) throw new Error('JOBS_TABLE_NAME not set');

  const item: Record<string, AttributeValue> = {
    JobId: { S: jobId },
    ExecutionArn: { S: executionArn },
    Status: { S: 'RUNNING' },
    UserId: { N: String(params.userId) },
    RepoFullName: { S: params.repoFullName },
    CreatedAt: { S: now },
    UpdatedAt: { S: now },
  };
  if (params.checkRunId) {
    item.CheckRunId = { N: String(params.checkRunId) };
  }

  await dynamoClient.send(
    new PutItemCommand({
      TableName: tableName,
      Item: item,
    }),
  );

  return { jobId, executionArn };
}
