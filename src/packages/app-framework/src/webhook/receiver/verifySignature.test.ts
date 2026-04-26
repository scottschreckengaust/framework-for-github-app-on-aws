import { verifySignature } from './verifySignature';
import { createHmac } from 'crypto';

const SECRET = 'test-webhook-secret-value';

function sign(payload: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

describe('verifySignature', () => {
  it('returns true for a valid signature', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature(body, signature, SECRET)).toBe(true);
  });

  it('returns false for an invalid signature', () => {
    const body = '{"action":"opened"}';
    const signature = 'sha256=deadbeef';
    expect(verifySignature(body, signature, SECRET)).toBe(false);
  });

  it('returns false for a missing signature', () => {
    const body = '{"action":"opened"}';
    expect(verifySignature(body, '', SECRET)).toBe(false);
  });

  it('returns false for a tampered body', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature('{"action":"closed"}', signature, SECRET)).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"action":"opened"}';
    const signature = sign(body, SECRET);
    expect(verifySignature(body, signature, 'wrong-secret')).toBe(false);
  });
});
