import { authorizeUser } from './authorizeUser';

const mockGetToken = jest.fn();
jest.mock('./tokenStore', () => ({
  getToken: (...args: unknown[]) => mockGetToken(...args),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('authorizeUser', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockFetch.mockReset();
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
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
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
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
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

  it('authorizes user with valid token and permissions', async () => {
    mockFetch
      .mockResolvedValueOnce({ status: 204 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ permission: 'admin' }),
      });
    mockGetToken.mockResolvedValue({
      gitHubUserId: 33333,
      login: 'admin-user',
      encryptedAccessToken: 'enc-token',
      encryptedRefreshToken: 'enc-refresh',
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
    expect(result.userToken).toBeDefined();
  });
});
