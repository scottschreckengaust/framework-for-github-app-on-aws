const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
const MAX_RETRIES = 3;

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const resp = await fetch(url, options);
    if (resp.ok || !RETRYABLE_STATUS_CODES.has(resp.status)) {
      return resp;
    }
    if (attempt === maxRetries) {
      return resp;
    }
    const retryAfter = resp.headers.get('Retry-After');
    const delay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : Math.pow(2, attempt) * 1000;
    await new Promise((r) => setTimeout(r, delay));
  }
  throw new Error('unreachable');
}
