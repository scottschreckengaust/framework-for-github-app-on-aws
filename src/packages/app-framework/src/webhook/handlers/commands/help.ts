import { postComment } from '../../orchestration/reportComment';
import { CommandContext } from './types';

const AVAILABLE_COMMANDS = [
  '`help` - List available commands',
  '`echo <text>` - Echo back text',
  '`status` - Show running jobs (coming soon)',
  '`deploy <env>` - Deploy to environment (coming soon)',
];

export async function handleHelp(ctx: CommandContext): Promise<void> {
  const body = [
    `@${ctx.sender} Available commands:`,
    '',
    ...AVAILABLE_COMMANDS.map((c) => `- ${c}`),
  ].join('\n');
  await postComment({
    token: ctx.token,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: ctx.issueNumber,
    body,
  });
}
