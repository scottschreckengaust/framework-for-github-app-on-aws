import { CommandContext } from './types';
import { postComment } from '../../orchestration/reportComment';
import { startExecution } from '../../orchestration/startExecution';

export async function handleCheck(ctx: CommandContext): Promise<void> {
  const stateMachineArn = process.env.CI_CHECK_STATE_MACHINE_ARN;
  if (!stateMachineArn) {
    await postComment({
      token: ctx.token,
      owner: ctx.owner,
      repo: ctx.repo,
      issueNumber: ctx.issueNumber,
      body: `@${ctx.sender} CI Check workflow is not configured.`,
    });
    return;
  }

  // For PRs, we need the head SHA. For now use a placeholder.
  // In production, this would come from the PR event payload.
  const headSha = ctx.args || 'HEAD';

  const result = await startExecution({
    stateMachineArn,
    input: {
      token: ctx.token,
      owner: ctx.owner,
      repo: ctx.repo,
      headSha,
    },
    userId: 0,
    repoFullName: `${ctx.owner}/${ctx.repo}`,
  });

  await postComment({
    token: ctx.token,
    owner: ctx.owner,
    repo: ctx.repo,
    issueNumber: ctx.issueNumber,
    body: `@${ctx.sender} CI Check started (Job: ${result.jobId}). Check the Checks tab for progress.`,
  });
}
