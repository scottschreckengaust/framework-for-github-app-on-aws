import { authorizeUser } from './authorizeUser';

const mockGetToken = jest.fn();
const mockPutToken = jest.fn();
jest.mock('./tokenStore', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
  putToken: (...args: unknown[]) => mockPutToken(...args),
}));

jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({ SecretString: 'test-client-secret' }),
  })),
  GetSecretValueCommand: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('authorizeUser', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockPutToken.mockReset();
    mockFetch.mockReset();
    process.env.GITHUB_CLIENT_ID = 'test-client-id';
    process.env.OAUTH_CLIENT_SECRET_ARN =
      'arn:aws:secretsmanager:us-east-1:123:secret:test';
  });

  it('rejects user not in sbalswa org', async () => {
    mockFetch.mockResolvedValueOnce({ status: 404 });
    const result = await authorizeUser({
      senderLogin: 'outsider',
      senderId: 99999,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('not a member');
  });

  it('rejects user without repo write access', async () => {
    mockFetch.mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permission: 'read' }),
    });
    const result = await authorizeUser({
      senderLogin: 'reader',
      senderId: 11111,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('write access');
  });

  it('returns needsAuth when user has no OAuth token', async () => {
    mockFetch.mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permission: 'write' }),
    });
    mockGetToken.mockResolvedValue(null);
    const result = await authorizeUser({
      senderLogin: 'newuser',
      senderId: 22222,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.needsAuth).toBe(true);
  });

  it('authorizes user with valid (non-expired) token', async () => {
    mockFetch.mockResolvedValueOnce({ status: 204 }).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ permission: 'admin' }),
    });
    mockGetToken.mockResolvedValue({
      gitHubUserId: 33333,
      login: 'admin-user',
      encryptedAccessToken: 'ghu_valid',
      encryptedRefreshToken: 'ghr_refresh',
      tokenExpiry: new Date(Date.now() + 3600000).toISOString(),
      scopes: 'repo',
      lastUsed: new Date().toISOString(),
    });
    const result = await authorizeUser({
      senderLogin: 'admin-user',
      senderId: 33333,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(true);
    expect(result.userToken?.accessToken).toBe('ghu_valid');
    expect(mockPutToken).not.toHaveBeenCalled();
  });

  it('auto-refreshes expired token and stores new one', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'write' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'ghu_refreshed',
          refresh_token: 'ghr_new_refresh',
          expires_in: 28800,
        }),
      });
    mockGetToken.mockResolvedValue({
      gitHubUserId: 44444,
      login: 'expireduser',
      encryptedAccessToken: 'ghu_old',
      encryptedRefreshToken: 'ghr_old_refresh',
      tokenExpiry: new Date(Date.now() - 1000).toISOString(),
      scopes: '',
      lastUsed: new Date().toISOString(),
    });
    mockPutToken.mockResolvedValue(undefined);

    const result = await authorizeUser({
      senderLogin: 'expireduser',
      senderId: 44444,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(true);
    expect(result.userToken?.accessToken).toBe('ghu_refreshed');
    expect(mockPutToken).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedAccessToken: 'ghu_refreshed',
        encryptedRefreshToken: 'ghr_new_refresh',
      }),
    );
  });

  it('returns needsAuth when refresh fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'write' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ error: 'bad_refresh_token' }),
      });
    mockGetToken.mockResolvedValue({
      gitHubUserId: 55555,
      login: 'badrefresh',
      encryptedAccessToken: 'ghu_old',
      encryptedRefreshToken: 'ghr_invalid',
      tokenExpiry: new Date(Date.now() - 1000).toISOString(),
      scopes: '',
      lastUsed: new Date().toISOString(),
    });

    const result = await authorizeUser({
      senderLogin: 'badrefresh',
      senderId: 55555,
      repoFullName: 'sbalswa/test-repo',
      installationToken: 'ghs_test',
      orgName: 'sbalswa',
    });
    expect(result.authorized).toBe(false);
    expect(result.needsAuth).toBe(true);
  });
});
