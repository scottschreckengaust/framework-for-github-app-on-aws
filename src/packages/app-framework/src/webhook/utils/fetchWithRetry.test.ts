import { fetchWithRetry } from './fetchWithRetry';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe('fetchWithRetry', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('returns immediately on success', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    const resp = await fetchWithRetry('https://api.github.com/test', {});
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('returns immediately on permanent error (403)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403 });
    const resp = await fetchWithRetry('https://api.github.com/test', {});
    expect(resp.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 with exponential backoff', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, headers: new Map() })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = fetchWithRetry('https://api.github.com/test', {}, 3);
    // First call fails with 500, waits 1s, retries
    await jest.advanceTimersByTimeAsync(1000);
    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After header on 429', async () => {
    const headers = new Map([['Retry-After', '5']]);
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = fetchWithRetry('https://api.github.com/test', {}, 3);
    await jest.advanceTimersByTimeAsync(5000);
    const resp = await promise;
    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after max retries', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, headers: new Map() });

    const promise = fetchWithRetry('https://api.github.com/test', {}, 2);
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(2000);
    const resp = await promise;
    expect(resp.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
