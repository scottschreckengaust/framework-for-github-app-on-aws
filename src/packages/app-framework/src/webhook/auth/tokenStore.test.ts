import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { getToken, putToken, deleteToken } from './tokenStore';

const mockDynamoDBClient = mockClient(DynamoDBClient);

beforeEach(() => {
  mockDynamoDBClient.reset();
  process.env.USER_TOKENS_TABLE_NAME = 'test-tokens-table';
});

afterEach(() => {
  mockDynamoDBClient.reset();
  jest.clearAllMocks();
});

describe('tokenStore', () => {
  it('getToken returns token data for existing user', async () => {
    mockDynamoDBClient.on(GetItemCommand).resolves({
      Item: {
        GitHubUserId: { N: '12345' },
        Login: { S: 'testuser' },
        EncryptedAccessToken: { S: 'enc-access-token' },
        EncryptedRefreshToken: { S: 'enc-refresh-token' },
        TokenExpiry: { S: '2026-04-26T12:00:00Z' },
        Scopes: { S: 'repo,user' },
        LastUsed: { S: '2026-04-26T10:00:00Z' },
      },
    });
    const result = await getToken(12345);
    expect(result).toEqual({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'enc-access-token',
      encryptedRefreshToken: 'enc-refresh-token',
      tokenExpiry: '2026-04-26T12:00:00Z',
      scopes: 'repo,user',
      lastUsed: '2026-04-26T10:00:00Z',
    });
  });

  it('getToken returns null for non-existent user', async () => {
    mockDynamoDBClient.on(GetItemCommand).resolves({});
    const result = await getToken(99999);
    expect(result).toBeNull();
  });

  it('putToken stores token data', async () => {
    mockDynamoDBClient.on(PutItemCommand).resolves({});
    await putToken({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'enc-access',
      encryptedRefreshToken: 'enc-refresh',
      tokenExpiry: '2026-04-26T12:00:00Z',
      scopes: 'repo',
      lastUsed: '2026-04-26T10:00:00Z',
    });
    expect(mockDynamoDBClient.commandCalls(PutItemCommand)).toHaveLength(1);
    expect(
      mockDynamoDBClient.commandCalls(PutItemCommand, {
        TableName: 'test-tokens-table',
        Item: {
          GitHubUserId: { N: '12345' },
          Login: { S: 'testuser' },
          EncryptedAccessToken: { S: 'enc-access' },
          EncryptedRefreshToken: { S: 'enc-refresh' },
          TokenExpiry: { S: '2026-04-26T12:00:00Z' },
          Scopes: { S: 'repo' },
          LastUsed: { S: '2026-04-26T10:00:00Z' },
        },
      }),
    ).toHaveLength(1);
  });

  it('deleteToken removes token data', async () => {
    mockDynamoDBClient.on(DeleteItemCommand).resolves({});
    await deleteToken(12345);
    expect(mockDynamoDBClient.commandCalls(DeleteItemCommand)).toHaveLength(1);
    expect(
      mockDynamoDBClient.commandCalls(DeleteItemCommand, {
        TableName: 'test-tokens-table',
        Key: { GitHubUserId: { N: '12345' } },
      }),
    ).toHaveLength(1);
  });
});
