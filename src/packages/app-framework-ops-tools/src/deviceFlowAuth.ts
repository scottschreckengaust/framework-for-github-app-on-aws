import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { KMSClient, EncryptCommand } from '@aws-sdk/client-kms';

export async function deviceFlowAuth(
  clientId: string,
  userTokensTable: string,
  kmsKeyArn?: string,
): Promise<void> {
  // Step 1: Request device code
  const codeResp = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    // prettier-ignore
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ client_id: clientId }),
  });
  const codeData = (await codeResp.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  };

  console.log('');
  console.log('====================================');
  console.log(`  Go to: ${codeData.verification_uri}`);
  console.log(`  Enter code: ${codeData.user_code}`);
  console.log('====================================');
  console.log('');
  console.log('Waiting for authorization...');

  // Step 2: Poll for token
  const interval = (codeData.interval || 5) * 1000;
  const expires = Date.now() + codeData.expires_in * 1000;

  while (Date.now() < expires) {
    await new Promise((r) => setTimeout(r, interval));

    const tokenResp = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        // prettier-ignore
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          device_code: codeData.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      },
    );
    const tokenData = (await tokenResp.json()) as Record<string, unknown>;

    if (tokenData.access_token) {
      const accessToken = tokenData.access_token as string;
      const refreshToken = (tokenData.refresh_token as string) || '';
      const expiresIn = (tokenData.expires_in as number) || 28800;
      const scope = (tokenData.scope as string) || '';

      // Step 3: Get user info
      const userResp = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      });
      const userData = (await userResp.json()) as {
        id: number;
        login: string;
      };

      // Step 4: Optionally encrypt tokens with KMS
      let storedAccessToken = accessToken;
      let storedRefreshToken = refreshToken;

      if (kmsKeyArn) {
        const kms = new KMSClient({});
        const encAccess = await kms.send(
          new EncryptCommand({
            KeyId: kmsKeyArn,
            Plaintext: Buffer.from(accessToken),
          }),
        );
        storedAccessToken = Buffer.from(encAccess.CiphertextBlob!).toString(
          'base64',
        );

        if (refreshToken) {
          const encRefresh = await kms.send(
            new EncryptCommand({
              KeyId: kmsKeyArn,
              Plaintext: Buffer.from(refreshToken),
            }),
          );
          storedRefreshToken = Buffer.from(encRefresh.CiphertextBlob!).toString(
            'base64',
          );
        }
        console.log('Tokens encrypted with KMS key');
      }

      // Step 5: Store in DynamoDB
      const ddb = new DynamoDBClient({});
      const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();

      await ddb.send(
        new PutItemCommand({
          TableName: userTokensTable,
          Item: {
            GitHubUserId: { N: String(userData.id) },
            Login: { S: userData.login },
            EncryptedAccessToken: { S: storedAccessToken },
            EncryptedRefreshToken: { S: storedRefreshToken },
            TokenExpiry: { S: expiry },
            Scopes: { S: scope },
            LastUsed: { S: new Date().toISOString() },
          },
        }),
      );

      console.log('');
      console.log(`Authorized: ${userData.login} (ID: ${userData.id})`);
      console.log(`Token expires: ${expiry}`);
      console.log(`Stored in table: ${userTokensTable}`);
      return;
    }

    if (tokenData.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    }

    if (tokenData.error === 'slow_down') {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    if (tokenData.error === 'expired_token') {
      console.error('Authorization expired. Please try again.');
      process.exit(1);
    }

    console.error(`Error: ${tokenData.error} - ${tokenData.error_description}`);
    process.exit(1);
  }

  console.error('Timed out waiting for authorization.');
  process.exit(1);
}
