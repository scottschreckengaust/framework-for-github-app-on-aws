jest.mock('./tokenEncryption', () => ({
  encryptToken: jest
    .fn()
    .mockImplementation((plaintext: string) =>
      Promise.resolve(`encrypted:${plaintext}`),
    ),
  decryptToken: jest
    .fn()
    .mockImplementation((ciphertext: string) =>
      Promise.resolve(ciphertext.replace('encrypted:', '')),
    ),
}));

import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
// eslint-disable-next-line import/no-extraneous-dependencies
import { mockClient } from 'aws-sdk-client-mock';
import { getToken, putToken, deleteToken } from './tokenStore';

const mockDynamoDBClient = mockClient(DynamoDBClient);

beforeEach(() => {
  mockDynamoDBClient.reset();
  process.env.USER_TOKENS_TABLE_NAME = 'test-tokens-table';
  process.env.TOKEN_ENCRYPTION_KEY_ARN = 'arn:aws:kms:us-east-1:123:key/test';
});

afterEach(() => {
  mockDynamoDBClient.reset();
  jest.clearAllMocks();
});

describe('tokenStore', () => {
  it('getToken returns decrypted token data for existing user', async () => {
    mockDynamoDBClient.on(GetItemCommand).resolves({
      Item: {
        GitHubUserId: { N: '12345' },
        Login: { S: 'testuser' },
        EncryptedAccessToken: { S: 'encrypted:ghu_realtoken' },
        EncryptedRefreshToken: { S: 'encrypted:ghr_realrefresh' },
        TokenExpiry: { S: '2026-04-26T12:00:00Z' },
        Scopes: { S: 'repo,user' },
        LastUsed: { S: '2026-04-26T10:00:00Z' },
      },
    });
    const result = await getToken(12345);
    expect(result).toEqual({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'ghu_realtoken',
      encryptedRefreshToken: 'ghr_realrefresh',
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

  it('putToken encrypts and stores token data', async () => {
    mockDynamoDBClient.on(PutItemCommand).resolves({});
    await putToken({
      gitHubUserId: 12345,
      login: 'testuser',
      encryptedAccessToken: 'ghu_plaintoken',
      encryptedRefreshToken: 'ghr_plainrefresh',
      tokenExpiry: '2026-04-26T12:00:00Z',
      scopes: 'repo',
      lastUsed: '2026-04-26T10:00:00Z',
    });
    expect(mockDynamoDBClient.commandCalls(PutItemCommand)).toHaveLength(1);
    const call = mockDynamoDBClient.commandCalls(PutItemCommand)[0];
    expect(call.args[0].input.Item?.EncryptedAccessToken?.S).toBe(
      'encrypted:ghu_plaintoken',
    );
    expect(call.args[0].input.Item?.EncryptedRefreshToken?.S).toBe(
      'encrypted:ghr_plainrefresh',
    );
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
