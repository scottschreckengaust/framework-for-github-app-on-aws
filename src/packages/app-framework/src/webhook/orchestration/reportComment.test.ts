import { postComment, updateComment } from './reportComment';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('reportComment', () => {
  beforeEach(() => mockFetch.mockReset());

  it('posts a new comment and returns its id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 99 }),
    });
    const id = await postComment({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      issueNumber: 5,
      body: 'Working on it...',
    });
    expect(id).toBe(99);
  });

  it('updates an existing comment', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateComment({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      commentId: 99,
      body: 'Done!',
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/issues/comments/99',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
