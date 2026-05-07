import {
  getCommandHandler,
  getDefaultHandler,
  CommandContext,
} from './commands';
import { authorizeUser } from '../auth/authorizeUser';
import { postComment } from '../orchestration/reportComment';
import { isAlreadyProcessed } from '../utils/idempotency';
import {
  publishEventProcessed,
  publishCommandExecuted,
  publishAuthResult,
  publishError,
  EventMetricContext,
} from '../utils/metrics';

const BOT_TRIGGERS = ['@ai3-mvp', '/ai3-mvp'];

// prettier-ignore
interface CommentEvent {
  'detail-type': string;
  'detail': {
    delivery_id: string;
    action: string;
    sender: { login: string; id: number };
    repository: { full_name: string };
    installation?: { id: number; app_id: number };
    organization?: { login: string };
    payload: {
      comment: { body: string };
      issue: { number: number };
    };
  };
}

async function getInstallationToken(): Promise<string | null> {
  const appId = process.env.APP_ID;
  const functionName = process.env.INSTALLATION_TOKEN_FUNCTION_NAME;
  const nodeId = process.env.NODE_ID;
  if (!appId || !functionName || !nodeId) return null;

  try {
    /* eslint-disable import/no-unresolved, import/no-extraneous-dependencies */
    const { LambdaClient, InvokeCommand } = await import(
      '@aws-sdk/client-lambda'
    );
    /* eslint-enable import/no-unresolved, import/no-extraneous-dependencies */
    const lambda = new LambdaClient({});
    const accountId =
      (process.env.AWS_LAMBDA_FUNCTION_ARN || '').split(':')[4] || 'unknown';
    const event = {
      version: '2.0',
      routeKey: 'POST /tokens/installation',
      rawPath: '/tokens/installation',
      headers: { 'content-type': 'application/json' },
      requestContext: {
        http: { method: 'POST', path: '/tokens/installation' },
        accountId,
        stage: '$default',
        requestId: 'internal',
        authorizer: {
          iam: {
            accessKey: 'internal',
            accountId,
            userArn: process.env.AWS_LAMBDA_FUNCTION_ARN || 'unknown',
          },
        },
      },
      body: JSON.stringify({ appId: Number(appId), nodeId }),
      isBase64Encoded: false,
    };
    const resp = await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify(event),
      }),
    );
    const respPayload = JSON.parse(new TextDecoder().decode(resp.Payload));
    if (respPayload.statusCode !== 200) {
      console.error('Installation token error', {
        statusCode: respPayload?.statusCode,
      });
      return null;
    }
    const body = JSON.parse(respPayload.body);
    return body.installationToken || null;
  } catch (e) {
    console.error('Failed to get installation token', e);
    return null;
  }
}

export const handler = async (event: CommentEvent): Promise<void> => {
  const { detail } = event;
  const commentBody = detail.payload.comment.body;

  const trigger = BOT_TRIGGERS.find((t) => commentBody.includes(t));
  if (!trigger) {
    return;
  }

  if (detail.action !== 'created') {
    return;
  }

  const isDuplicate = await isAlreadyProcessed(
    detail.delivery_id,
    'commentHandler',
  );
  if (isDuplicate) {
    return;
  }

  const [owner, repo] = detail.repository.full_name.split('/');
  const orgName = process.env.ORG_NAME || owner;

  const metricCtx: EventMetricContext = {
    appId: process.env.APP_ID || detail.installation?.id,
    orgName: detail.organization?.login || owner,
    eventType: event['detail-type'],
    handlerName: 'commentHandler',
  };
  publishEventProcessed(metricCtx);

  const installationToken = await getInstallationToken();

  if (!installationToken) {
    console.error('No installation token available', {
      deliveryId: detail.delivery_id,
    });
    return;
  }

  try {
    const authResult = await authorizeUser({
      senderLogin: detail.sender.login,
      senderId: detail.sender.id,
      repoFullName: detail.repository.full_name,
      installationToken,
      orgName,
    });

    if (!authResult.authorized) {
      publishAuthResult(metricCtx, false);
      if (authResult.needsAuth) {
        const authUrl = process.env.AUTH_LOGIN_URL || '';
        await postComment({
          token: installationToken,
          owner,
          repo,
          issueNumber: detail.payload.issue.number,
          body: `@${detail.sender.login} I need you to authorize this app before I can act on your behalf.\n\n[Open authorization page](${authUrl}?repo=${detail.repository.full_name}&issue=${detail.payload.issue.number}) (tip: open in a new tab)`,
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

    publishAuthResult(metricCtx, true);

    const command = commentBody
      .slice(commentBody.indexOf(trigger) + trigger.length)
      .trim();
    const [cmdName, ...cmdArgs] = command.split(' ');

    const ctx: CommandContext = {
      args: cmdArgs.join(' '),
      token: authResult.userToken!.accessToken,
      owner,
      repo,
      issueNumber: detail.payload.issue.number,
      sender: detail.sender.login,
      userId: detail.sender.id,
    };

    const commandHandler = getCommandHandler(cmdName) || getDefaultHandler();
    await commandHandler(ctx);
    publishCommandExecuted(metricCtx, cmdName);

    console.log(
      JSON.stringify({
        handler: 'commentHandler',
        deliveryId: detail.delivery_id,
        sender: detail.sender.login,
        command: cmdName,
        args: cmdArgs.join(' '),
      }),
    );
  } catch (error) {
    publishError(metricCtx);
    console.error('Handler error', { deliveryId: detail.delivery_id, error });
    try {
      await postComment({
        token: installationToken,
        owner,
        repo,
        issueNumber: detail.payload.issue.number,
        body: `@${detail.sender.login} Sorry, I encountered an error processing your request. The team has been notified.`,
      });
    } catch (replyError) {
      console.error('Failed to post error reply', replyError);
    }
    throw error;
  }
};
