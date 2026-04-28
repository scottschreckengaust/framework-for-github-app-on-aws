import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getToken, putToken } from './tokenStore';
import { fetchWithRetry } from '../utils/fetchWithRetry';

export interface AuthorizeInput {
  senderLogin: string;
  senderId: number;
  repoFullName: string;
  installationToken: string;
  orgName: string;
}

export interface AuthResult {
  authorized: boolean;
  reason?: string;
  needsAuth?: boolean;
  userToken?: {
    accessToken: string;
    tokenExpiry: string;
  };
}

const WRITE_PERMISSIONS = new Set(['write', 'admin', 'maintain']);
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const secretsClient = new SecretsManagerClient({});
let cachedClientSecret: string | undefined;

async function getClientSecret(): Promise<string | null> {
  if (cachedClientSecret) return cachedClientSecret;
  const arn = process.env.OAUTH_CLIENT_SECRET_ARN;
  if (!arn) return null;
  const resp = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  cachedClientSecret = resp.SecretString;
  return cachedClientSecret || null;
}

async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> {
  const resp = await fetchWithRetry('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) return null;
  const data = (await resp.json()) as Record<string, unknown>;
  if (data.error) return null;
  return data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
}

export async function authorizeUser(
  input: AuthorizeInput,
): Promise<AuthResult> {
  const orgCheckResp = await fetchWithRetry(
    `https://api.github.com/orgs/${input.orgName}/members/${input.senderLogin}`,
    {
      headers: {
        Authorization: `Bearer ${input.installationToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (orgCheckResp.status !== 204) {
    return {
      authorized: false,
      reason: `${input.senderLogin} is not a member of ${input.orgName}`,
    };
  }

  const permResp = await fetchWithRetry(
    `https://api.github.com/repos/${input.repoFullName}/collaborators/${input.senderLogin}/permission`,
    {
      headers: {
        Authorization: `Bearer ${input.installationToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (!permResp.ok) {
    return {
      authorized: false,
      reason: `Failed to check permissions for ${input.senderLogin} on ${input.repoFullName}`,
    };
  }
  const permData = (await permResp.json()) as { permission: string };
  if (!WRITE_PERMISSIONS.has(permData.permission)) {
    return {
      authorized: false,
      reason: `${input.senderLogin} does not have write access to ${input.repoFullName}`,
    };
  }

  const token = await getToken(input.senderId);
  if (!token) {
    return { authorized: false, needsAuth: true };
  }

  let accessToken = token.encryptedAccessToken;
  let tokenExpiry = token.tokenExpiry;

  const expiresAt = new Date(tokenExpiry).getTime();
  const isExpired = Date.now() > expiresAt - REFRESH_BUFFER_MS;

  if (isExpired) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = await getClientSecret();

    if (!clientId || !clientSecret || !token.encryptedRefreshToken) {
      return { authorized: false, needsAuth: true };
    }

    const refreshed = await refreshAccessToken(
      token.encryptedRefreshToken,
      clientId,
      clientSecret,
    );

    if (!refreshed) {
      return { authorized: false, needsAuth: true };
    }

    tokenExpiry = new Date(
      Date.now() + refreshed.expires_in * 1000,
    ).toISOString();
    accessToken = refreshed.access_token;

    await putToken({
      ...token,
      encryptedAccessToken: refreshed.access_token,
      encryptedRefreshToken: refreshed.refresh_token,
      tokenExpiry,
      lastUsed: new Date().toISOString(),
    });

    console.log('Token refreshed', {
      userId: input.senderId,
      login: input.senderLogin,
    });
  }

  return {
    authorized: true,
    userToken: {
      accessToken,
      tokenExpiry,
    },
  };
}
