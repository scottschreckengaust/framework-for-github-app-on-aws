const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutItemCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { handler } from './oauthLogin.handler';

jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn().mockReturnValue(Buffer.from('a'.repeat(32))),
}));

describe('oauthLogin handler', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    process.env.AUTH_STATE_TABLE_NAME = 'test-auth-state';
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CALLBACK_URL = 'https://api.example.com/auth/callback';
  });

  it('redirects to GitHub OAuth with state parameter', async () => {
    const event = {
      queryStringParameters: {
        repo: 'sbalswa/test-repo',
        issue: '42',
      },
    };
    const result = await handler(event as any);
    expect(result.statusCode).toBe(302);
    expect(result.headers?.Location).toContain('github.com/login/oauth/authorize');
    expect(result.headers?.Location).toContain('client_id=test-client-id');
    expect(result.headers?.Location).toContain('state=');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
