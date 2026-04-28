import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({});

export async function encryptToken(
  plaintext: string,
  keyArn: string,
): Promise<string> {
  const resp = await kms.send(
    new EncryptCommand({
      KeyId: keyArn,
      Plaintext: Buffer.from(plaintext, 'utf8'),
    }),
  );
  return Buffer.from(resp.CiphertextBlob!).toString('base64');
}

export async function decryptToken(ciphertext: string): Promise<string> {
  const resp = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    }),
  );
  return Buffer.from(resp.Plaintext!).toString('utf8');
}
