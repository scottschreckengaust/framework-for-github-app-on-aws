import { createHash } from 'crypto';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { KMSClient, SignCommand } from '@aws-sdk/client-kms';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { USER_AGENT } from './constants';

const kms = new KMSClient({ customUserAgent: USER_AGENT });
const dynamoDB = new DynamoDBClient({ customUserAgent: USER_AGENT });
const secretsManager = new SecretsManagerClient({ customUserAgent: USER_AGENT });

export interface UpdateWebhookConfigOptions {
  appId: number;
  webhookUrl: string;
  webhookSecretArn: string;
  callbackUrl?: string;
  homepageUrl?: string;
  setupUrl?: string;
  tableName?: string;
  kmsKeyArn?: string;
}

/**
 * Signs a message using an imported KMS key (RS256).
 */
async function kmsSign(keyArn: string, message: string): Promise<Buffer> {
  const messageHash = createHash('sha256').update(message).digest();
  const signResponse = await kms.send(
    new SignCommand({
      KeyId: keyArn,
      Message: messageHash,
      MessageType: 'DIGEST',
      SigningAlgorithm: 'RSASSA_PKCS1_V1_5_SHA_256',
    }),
  );
  if (!signResponse.Signature || signResponse.Signature.length === 0) {
    throw new Error('KMS signing failed: Signature is missing or empty');
  }
  return Buffer.from(signResponse.Signature);
}

/**
 * Generates a JWT for the GitHub App using KMS-based signing.
 */
async function generateJwt(appId: number, keyArn: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 8 * 60, iss: appId };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    'base64url',
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await kmsSign(keyArn, signingInput);
  const encodedSignature = signature.toString('base64url');
  return `${signingInput}.${encodedSignature}`;
}

/**
 * Looks up the KMS key ARN for an App ID from the DynamoDB Apps table.
 */
async function lookupKmsKeyArn(
  appId: number,
  tableName: string,
): Promise<string> {
  const result = await dynamoDB.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { AppId: { N: appId.toString() } },
    }),
  );
  if (!result.Item || !result.Item.KmsKeyArn?.S) {
    throw new Error(
      `No KMS key found for App ID ${appId} in table "${tableName}"`,
    );
  }
  return result.Item.KmsKeyArn.S;
}

/**
 * Retrieves the webhook secret value from Secrets Manager.
 */
async function getWebhookSecret(secretArn: string): Promise<string> {
  const result = await secretsManager.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  if (!result.SecretString) {
    throw new Error(
      `Secret at ARN "${secretArn}" has no string value`,
    );
  }
  return result.SecretString;
}

/**
 * Updates the GitHub App webhook configuration (URL + secret) via PATCH /app/hook/config.
 */
async function patchWebhookHookConfig(
  jwt: string,
  webhookUrl: string,
  webhookSecret: string,
): Promise<void> {
  const response = await fetch('https://api.github.com/app/hook/config', {
    method: 'PATCH',
    headers: {
      // eslint-disable-next-line quote-props
      Authorization: `Bearer ${jwt}`,
      // eslint-disable-next-line quote-props
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      url: webhookUrl,
      secret: webhookSecret,
      content_type: 'json',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `PATCH /app/hook/config failed (${response.status}): ${errorText}`,
    );
  }
  console.log(`Webhook URL updated to: ${webhookUrl}`);
}

/**
 * Updates the GitHub App settings (callback URL, homepage URL, setup URL) via PATCH /app.
 */
async function patchAppSettings(
  jwt: string,
  options: { callbackUrl?: string; homepageUrl?: string; setupUrl?: string },
): Promise<void> {
  // GitHub API expects callback_urls as an array
  const payload: Record<string, unknown> = {};
  if (options.callbackUrl) {
    payload.callback_urls = [options.callbackUrl];
  }
  if (options.homepageUrl) {
    payload.homepage_url = options.homepageUrl;
  }
  if (options.setupUrl) {
    payload.setup_url = options.setupUrl;
  }

  if (Object.keys(payload).length === 0) {
    return;
  }

  const response = await fetch('https://api.github.com/app', {
    method: 'PATCH',
    headers: {
      // eslint-disable-next-line quote-props
      Authorization: `Bearer ${jwt}`,
      // eslint-disable-next-line quote-props
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `PATCH /app failed (${response.status}): ${errorText}`,
    );
  }

  const updated: string[] = [];
  if (options.callbackUrl) updated.push(`callback_url=${options.callbackUrl}`);
  if (options.homepageUrl) updated.push(`homepage_url=${options.homepageUrl}`);
  if (options.setupUrl) updated.push(`setup_url=${options.setupUrl}`);
  console.log(`App settings updated: ${updated.join(', ')}`);
}

/**
 * Main entry point: updates the GitHub App webhook config and optional app URLs.
 *
 * Steps:
 * 1. Resolve the KMS key ARN (from --kms-key-arn or DynamoDB lookup)
 * 2. Generate a JWT for the GitHub App
 * 3. Retrieve the webhook secret from Secrets Manager
 * 4. PATCH /app/hook/config with the new webhook URL and secret
 * 5. PATCH /app with callback URL, homepage URL, and setup URL (if provided)
 */
export async function updateWebhookConfig(
  options: UpdateWebhookConfigOptions,
): Promise<void> {
  const {
    appId,
    webhookUrl,
    webhookSecretArn,
    callbackUrl,
    homepageUrl,
    setupUrl,
    tableName,
    kmsKeyArn: providedKmsKeyArn,
  } = options;

  // Step 1: Resolve KMS key ARN
  let keyArn: string;
  if (providedKmsKeyArn) {
    keyArn = providedKmsKeyArn;
    console.log(`Using provided KMS key ARN: ${keyArn}`);
  } else {
    if (!tableName) {
      throw new Error(
        'Either --kms-key-arn or --table-name must be provided to resolve the signing key',
      );
    }
    console.log(
      `Looking up KMS key for App ID ${appId} in table "${tableName}"...`,
    );
    keyArn = await lookupKmsKeyArn(appId, tableName);
    console.log(`Found KMS key ARN: ${keyArn}`);
  }

  // Step 2: Generate JWT
  console.log('Generating JWT...');
  const jwt = await generateJwt(appId, keyArn);
  console.log('JWT generated successfully');

  // Step 3: Retrieve webhook secret from Secrets Manager
  console.log('Retrieving webhook secret from Secrets Manager...');
  const webhookSecret = await getWebhookSecret(webhookSecretArn);
  console.log('Webhook secret retrieved');

  // Step 4: Update webhook hook config
  console.log('Updating webhook hook config...');
  await patchWebhookHookConfig(jwt, webhookUrl, webhookSecret);

  // Step 5: Update app settings (if any URLs provided)
  if (callbackUrl || homepageUrl || setupUrl) {
    console.log('Updating app settings...');
    await patchAppSettings(jwt, { callbackUrl, homepageUrl, setupUrl });
  }

  console.log('');
  console.log('Webhook configuration update completed successfully.');
}
