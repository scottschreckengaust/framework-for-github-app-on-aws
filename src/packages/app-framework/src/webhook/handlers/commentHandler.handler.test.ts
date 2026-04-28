const mockAuthorizeUser = jest.fn();
jest.mock('../auth/authorizeUser', () => ({
  authorizeUser: (...args: unknown[]) => mockAuthorizeUser(...args),
}));

const mockPostComment = jest.fn();
jest.mock('../orchestration/reportComment', () => ({
  postComment: (...args: unknown[]) => mockPostComment(...args),
}));

const mockLambdaSend = jest.fn();
jest.mock(
  '@aws-sdk/client-lambda',
  () => ({
    LambdaClient: jest.fn(() => ({ send: mockLambdaSend })),
    InvokeCommand: jest.fn((params: unknown) => params),
  }),
  { virtual: true },
);

import { handler } from './commentHandler.handler';

describe('commentHandler', () => {
  beforeEach(() => {
    mockAuthorizeUser.mockReset();
    mockPostComment.mockReset();
    mockLambdaSend.mockReset();
    process.env.ORG_NAME = 'sbalswa';
    process.env.AUTH_LOGIN_URL = 'https://example.com/auth/login';
    process.env.APP_ID = '12345';
    process.env.INSTALLATION_TOKEN_FUNCTION_NAME = 'test-token-fn';
    process.env.NODE_ID = 'MDEyOk9yZ2FuaXphdGlvbjE=';
    mockLambdaSend.mockResolvedValue({
      Payload: new TextEncoder().encode(
        JSON.stringify({
          statusCode: 200,
          body: JSON.stringify({ installationToken: 'ghs_mock_install_token' }),
        }),
      ),
    });
  });

  it('skips comments not mentioning the bot', async () => {
    // prettier-ignore
    const event = {
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'del-1',
        action: 'created',
        sender: { login: 'someone', id: 222 },
        repository: { full_name: 'sbalswa/test-repo' },
        payload: {
          comment: { body: 'just a regular comment' },
          issue: { number: 5 },
        },
      },
    };
    await handler(event as any);
    expect(mockAuthorizeUser).not.toHaveBeenCalled();
  });

  it('replies with auth link when user needs authorization', async () => {
    mockAuthorizeUser.mockResolvedValue({
      authorized: false,
      needsAuth: true,
    });
    mockPostComment.mockResolvedValue(1);

    // prettier-ignore
    const event = {
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'del-2',
        action: 'created',
        sender: { login: 'newuser', id: 111 },
        repository: { full_name: 'sbalswa/test-repo' },
        payload: {
          comment: { body: '@ai3-mvp hello' },
          issue: { number: 5 },
        },
      },
    };
    await handler(event as any);
    expect(mockPostComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('authorize'),
      }),
    );
  });

  it('responds with acknowledgment when user is authorized', async () => {
    mockAuthorizeUser.mockResolvedValue({
      authorized: true,
      userToken: {
        accessToken: 'ghu_test',
        tokenExpiry: '2026-04-28T12:00:00Z',
      },
    });
    mockPostComment.mockResolvedValue(2);

    // prettier-ignore
    const event = {
      'detail-type': 'issue_comment',
      detail: {
        delivery_id: 'del-3',
        action: 'created',
        sender: { login: 'admin', id: 333 },
        repository: { full_name: 'sbalswa/test-repo' },
        payload: {
          comment: { body: '@ai3-mvp deploy staging' },
          issue: { number: 10 },
        },
      },
    };
    await handler(event as any);
    expect(mockPostComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Available commands'),
      }),
    );
  });
});
