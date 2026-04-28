import { createCheckRun, updateCheckRun } from './reportCheckRun';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('reportCheckRun', () => {
  beforeEach(() => mockFetch.mockReset());

  it('creates a check run and returns its id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 42 }),
    });
    const id = await createCheckRun({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      headSha: 'abc123',
      name: 'ai3-mvp / deploy',
      status: 'in_progress',
    });
    expect(id).toBe(42);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/check-runs',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('updates a check run status', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await updateCheckRun({
      token: 'ghu_test',
      owner: 'sbalswa',
      repo: 'test-repo',
      checkRunId: 42,
      status: 'completed',
      conclusion: 'success',
      output: { title: 'Deploy succeeded', summary: 'All steps passed' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/sbalswa/test-repo/check-runs/42',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
