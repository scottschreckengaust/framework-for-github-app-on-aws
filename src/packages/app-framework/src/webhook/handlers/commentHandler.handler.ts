import { authorizeUser } from '../auth/authorizeUser';
import { postComment } from '../orchestration/reportComment';

const BOT_MENTION = '@ai3-mvp';

// prettier-ignore
interface CommentEvent {
  'detail-type': string;
  detail: {
    delivery_id: string;
    action: string;
    sender: { login: string; id: number };
    repository: { full_name: string };
    installation?: { id: number };
    payload: {
      comment: { body: string };
      issue: { number: number };
    };
  };
}

async function getInstallationToken(): Promise<string | null> {
  const appId = process.env.APP_ID;
  const endpoint = process.env.INSTALLATION_TOKEN_ENDPOINT;
  const nodeId = process.env.NODE_ID;
  if (!appId || !endpoint || !nodeId) return null;

  try {
    const {
      AppFrameworkClient,
      GetInstallationTokenCommand,
    } = require('@aws/app-framework-for-github-apps-on-aws-client');
    const { Sha256 } = require('@aws-crypto/sha256-js');
    const {
      defaultProvider,
    } = require('@aws-sdk/credential-provider-node');

    const client = new AppFrameworkClient({
      endpoint,
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: defaultProvider(),
      sha256: Sha256,
    });
    const resp = await client.send(
      new GetInstallationTokenCommand({
        appId: Number(appId),
        nodeId,
      }),
    );
    return resp.installationToken || null;
  } catch (e) {
    console.error('Failed to get installation token', e);
    return null;
  }
}

export const handler = async (event: CommentEvent): Promise<void> => {
  const { detail } = event;
  const commentBody = detail.payload.comment.body;

  if (!commentBody.includes(BOT_MENTION)) {
    return;
  }

  if (detail.action !== 'created') {
    return;
  }

  const [owner, repo] = detail.repository.full_name.split('/');
  const orgName = process.env.ORG_NAME || owner;

  const installationToken = await getInstallationToken();

  if (!installationToken) {
    console.error('No installation token available', {
      deliveryId: detail.delivery_id,
    });
    return;
  }

  const authResult = await authorizeUser({
    senderLogin: detail.sender.login,
    senderId: detail.sender.id,
    repoFullName: detail.repository.full_name,
    installationToken,
    orgName,
  });

  if (!authResult.authorized) {
    if (authResult.needsAuth) {
      const authUrl = process.env.AUTH_LOGIN_URL || '';
      await postComment({
        token: installationToken,
        owner,
        repo,
        issueNumber: detail.payload.issue.number,
        body: `@${detail.sender.login} I need you to [authorize this app](${authUrl}?repo=${detail.repository.full_name}&issue=${detail.payload.issue.number}) before I can act on your behalf.`,
      });
    } else {
      await postComment({
        token: installationToken,
        owner,
        repo,
        issueNumber: detail.payload.issue.number,
        body: `@${detail.sender.login} ${authResult.reason}`,
      });
    }
    return;
  }

  const command = commentBody.replace(BOT_MENTION, '').trim();
  await postComment({
    token: authResult.userToken!.accessToken,
    owner,
    repo,
    issueNumber: detail.payload.issue.number,
    body: `@${detail.sender.login} Received your command: \`${command}\`. Processing...`,
  });

  console.log(
    JSON.stringify({
      handler: 'commentHandler',
      deliveryId: detail.delivery_id,
      sender: detail.sender.login,
      command,
    }),
  );
};
