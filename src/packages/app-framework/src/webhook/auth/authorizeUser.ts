import { getToken } from './tokenStore';

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
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    tokenExpiry: string;
  };
}

const WRITE_PERMISSIONS = new Set(['write', 'admin', 'maintain']);

export async function authorizeUser(input: AuthorizeInput): Promise<AuthResult> {
  const orgCheckResp = await fetch(
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

  const permResp = await fetch(
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

  return {
    authorized: true,
    userToken: {
      encryptedAccessToken: token.encryptedAccessToken,
      encryptedRefreshToken: token.encryptedRefreshToken,
      tokenExpiry: token.tokenExpiry,
    },
  };
}
