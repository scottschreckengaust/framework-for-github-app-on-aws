import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }
  const expected = createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  const actual = signature.slice('sha256='.length);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
