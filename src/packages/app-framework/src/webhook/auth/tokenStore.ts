import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { encryptToken, decryptToken } from './tokenEncryption';

const client = new DynamoDBClient({});

export interface UserToken {
  gitHubUserId: number;
  login: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  tokenExpiry: string;
  scopes: string;
  lastUsed: string;
}

function getTableName(): string {
  const name = process.env.USER_TOKENS_TABLE_NAME;
  if (!name) throw new Error('USER_TOKENS_TABLE_NAME not set');
  return name;
}

function getKeyArn(): string {
  const arn = process.env.TOKEN_ENCRYPTION_KEY_ARN;
  if (!arn) throw new Error('TOKEN_ENCRYPTION_KEY_ARN not set');
  return arn;
}

export async function getToken(
  gitHubUserId: number,
): Promise<UserToken | null> {
  const resp = await client.send(
    new GetItemCommand({
      TableName: getTableName(),
      Key: { GitHubUserId: { N: String(gitHubUserId) } },
    }),
  );
  if (!resp.Item) return null;
  return {
    gitHubUserId: Number(resp.Item.GitHubUserId.N),
    login: resp.Item.Login.S!,
    encryptedAccessToken: await decryptToken(resp.Item.EncryptedAccessToken.S!),
    encryptedRefreshToken: await decryptToken(
      resp.Item.EncryptedRefreshToken.S!,
    ),
    tokenExpiry: resp.Item.TokenExpiry.S!,
    scopes: resp.Item.Scopes.S!,
    lastUsed: resp.Item.LastUsed.S!,
  };
}

export async function putToken(token: UserToken): Promise<void> {
  const keyArn = getKeyArn();
  const encAccess = await encryptToken(token.encryptedAccessToken, keyArn);
  const encRefresh = await encryptToken(token.encryptedRefreshToken, keyArn);
  await client.send(
    new PutItemCommand({
      TableName: getTableName(),
      Item: {
        GitHubUserId: { N: String(token.gitHubUserId) },
        Login: { S: token.login },
        EncryptedAccessToken: { S: encAccess },
        EncryptedRefreshToken: { S: encRefresh },
        TokenExpiry: { S: token.tokenExpiry },
        Scopes: { S: token.scopes },
        LastUsed: { S: token.lastUsed },
      },
    }),
  );
}

export async function deleteToken(gitHubUserId: number): Promise<void> {
  await client.send(
    new DeleteItemCommand({
      TableName: getTableName(),
      Key: { GitHubUserId: { N: String(gitHubUserId) } },
    }),
  );
}
