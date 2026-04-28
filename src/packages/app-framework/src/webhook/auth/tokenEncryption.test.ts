const mockSend = jest.fn();
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  EncryptCommand: jest.fn().mockImplementation((input) => ({ input })),
  DecryptCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { encryptToken, decryptToken } from './tokenEncryption';

describe('tokenEncryption', () => {
  beforeEach(() => mockSend.mockReset());

  it('encrypts a token and returns base64', async () => {
    mockSend.mockResolvedValue({
      CiphertextBlob: Buffer.from('encrypted-data'),
    });
    const result = await encryptToken('ghu_mytoken', 'arn:aws:kms:us-east-1:123:key/abc');
    expect(result).toBe(Buffer.from('encrypted-data').toString('base64'));
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('decrypts a base64 ciphertext and returns plaintext', async () => {
    mockSend.mockResolvedValue({
      Plaintext: Buffer.from('ghu_mytoken', 'utf8'),
    });
    const result = await decryptToken(Buffer.from('encrypted-data').toString('base64'));
    expect(result).toBe('ghu_mytoken');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
