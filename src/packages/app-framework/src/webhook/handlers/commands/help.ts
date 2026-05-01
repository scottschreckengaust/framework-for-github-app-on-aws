import { CommandContext } from './types';
import { postComment } from '../../orchestration/reportComment';

const AVAILABLE_COMMANDS = [
  '`help` - List available commands',
  '`echo <text>` - Echo back text',
  '`check [sha]` - Run CI check (creates GitHub Check Run)',
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
