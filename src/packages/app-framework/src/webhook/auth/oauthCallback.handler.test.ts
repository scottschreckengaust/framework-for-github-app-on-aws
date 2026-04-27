const mockDynamoSend = jest.fn();
const mockSecretsManagerSend = jest.fn();
const mockPutToken = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest
    .fn()
    .mockImplementation(() => ({ send: mockDynamoSend })),
  GetItemCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input, kind: 'get' })),
  DeleteItemCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input, kind: 'delete' })),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest
    .fn()
    .mockImplementation(() => ({ send: mockSecretsManagerSend })),
  GetSecretValueCommand: jest
    .fn()
    .mockImplementation((input: unknown) => ({ input })),
}));

jest.mock('./tokenStore', () => ({
  putToken: (...args: unknown[]) => mockPutToken(...args),
}));

import { handler } from './oauthCallback.handler';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('oauthCallback handler', () => {
  beforeEach(() => {
    mockDynamoSend.mockReset();
    mockPutToken.mockReset();
    mockSecretsManagerSend.mockReset();
    mockFetch.mockReset();
    process.env.AUTH_STATE_TABLE_NAME = 'test-auth-state';
    process.env.USER_TOKENS_TABLE_NAME = 'test-tokens';
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CLIENT_SECRET_ARN =
      'arn:aws:secretsmanager:us-east-1:123:secret:test';
  });

  it('rejects request with invalid state', async () => {
    mockDynamoSend.mockResolvedValue({ Item: undefined });
    const event = {
      queryStringParameters: { code: 'test-code', state: 'bad-state' },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(400);
    expect(result.body).toContain('Invalid state');
  });

  it('exchanges code for token and stores it', async () => {
    mockDynamoSend
      .mockResolvedValueOnce({
        Item: {
          StateNonce: { S: 'valid-state' },
          Repo: { S: 'sbalswa/test' },
          Issue: { S: '42' },
        },
      })
      .mockResolvedValueOnce({});

    mockSecretsManagerSend.mockResolvedValue({
      SecretString: 'test-client-secret',
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ghu_testtoken',
          refresh_token: 'ghr_testrefresh',
          expires_in: 28800,
          refresh_token_expires_in: 15897600,
          scope: '',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 12345, login: 'testuser' }),
      });

    mockPutToken.mockResolvedValue(undefined);

    const event = {
      queryStringParameters: { code: 'test-code', state: 'valid-state' },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Authorized');
    expect(mockPutToken).toHaveBeenCalledTimes(1);
  });
});
