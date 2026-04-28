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
    payload: {
      comment: { body: string };
      issue: { number: number };
    };
  };
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
  const installationToken = 'placeholder';

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
