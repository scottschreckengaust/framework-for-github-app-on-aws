const mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn().mockImplementation(() => ({ send: mockSfnSend })),
  StartExecutionCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

const mockDynamoSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { startExecution } from './startExecution';

describe('startExecution', () => {
  beforeEach(() => {
    mockSfnSend.mockReset();
    mockDynamoSend.mockReset();
    process.env.JOBS_TABLE_NAME = 'test-jobs';
  });

  it('starts a step function and records the job', async () => {
    mockSfnSend.mockResolvedValue({
      executionArn: 'arn:aws:states:us-east-1:123:execution:test:abc',
    });
    mockDynamoSend.mockResolvedValue({});

    const result = await startExecution({
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:test',
      input: { message: 'hello' },
      userId: 12345,
      repoFullName: 'sbalswa/test-repo',
    });

    expect(result.jobId).toBeDefined();
    expect(result.executionArn).toContain('execution');
    expect(mockSfnSend).toHaveBeenCalledTimes(1);
    expect(mockDynamoSend).toHaveBeenCalledTimes(1);
  });
});
