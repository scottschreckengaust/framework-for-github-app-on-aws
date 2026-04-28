import { postComment } from '../../orchestration/reportComment';
import { CommandContext } from './types';

export async function handleEcho(ctx: CommandContext): Promise<void> {
  await postComment({
    token: ctx.token,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: ctx.issueNumber,
    body: `@${ctx.sender} ${ctx.args || '(empty)'}`,
  });
}
