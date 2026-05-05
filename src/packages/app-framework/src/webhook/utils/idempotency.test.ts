const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input) => ({ input })),
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    constructor() {
      super('Conditional check failed');
      this.name = 'ConditionalCheckFailedException';
    }
  },
}));

import { isAlreadyProcessed } from './idempotency';
const { ConditionalCheckFailedException } = require('@aws-sdk/client-dynamodb');

describe('isAlreadyProcessed', () => {
  beforeEach(() => {
    mockSend.mockReset();
    process.env.JOBS_TABLE_NAME = 'test-jobs';
  });

  it('returns false for new delivery (not processed)', async () => {
    mockSend.mockResolvedValue({});
    const result = await isAlreadyProcessed('del-123', 'commentHandler');
    expect(result).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns true for duplicate delivery', async () => {
    mockSend.mockRejectedValue(new ConditionalCheckFailedException());
    const result = await isAlreadyProcessed('del-123', 'commentHandler');
    expect(result).toBe(true);
  });

  it('returns false when JOBS_TABLE_NAME not set', async () => {
    delete process.env.JOBS_TABLE_NAME;
    const result = await isAlreadyProcessed('del-123', 'commentHandler');
    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
