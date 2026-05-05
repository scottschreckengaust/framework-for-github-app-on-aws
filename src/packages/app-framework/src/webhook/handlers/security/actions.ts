import { Octokit } from '@octokit/rest';
import { ActionType, resolveConflicts } from './config';
import { SecurityFinding } from './types';

export interface ActionContext {
  octokit: Octokit;
  finding: SecurityFinding;
  snsTopicArn?: string;
}

async function executeBlock(ctx: ActionContext): Promise<void> {
  const { octokit, finding } = ctx;
  if (!finding.ref?.commit) return;

  await octokit.checks.create({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    name: 'ai3-mvp/security',
    head_sha: finding.ref.commit,
    status: 'completed',
    conclusion: 'failure',
    output: {
      title: `Security: ${finding.title}`,
      summary: finding.body,
    },
  });
}

async function executeIssue(ctx: ActionContext): Promise<void> {
  const { octokit, finding } = ctx;

  const existing = await octokit.issues.listForRepo({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    state: 'open',
    labels: `security,${finding.source}`,
    per_page: 100,
  });

  const duplicate = existing.data.find(
    (i) => i.title === `[Security] ${finding.title}`,
  );
  if (duplicate) return;

  await octokit.issues.create({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    title: `[Security] ${finding.title}`,
    body: [
      `**Severity:** ${finding.severity}`,
      `**Tool:** ${finding.tool ?? 'Unknown'}`,
      `**Alert:** ${finding.htmlUrl}`,
      '',
      finding.body,
    ].join('\n'),
    labels: ['security', finding.source],
  });
}

async function executeComment(ctx: ActionContext): Promise<void> {
  const { octokit, finding } = ctx;
  const message = [
    `**:shield: ${finding.severity.toUpperCase()} security finding**`,
    '',
    `**${finding.title}**`,
    finding.body,
    '',
    `[View alert](${finding.htmlUrl})`,
  ].join('\n');

  if (finding.ref?.pr) {
    await octokit.issues.createComment({
      owner: finding.repo.owner,
      repo: finding.repo.name,
      issue_number: finding.ref.pr,
      body: message,
    });
  } else if (finding.ref?.commit) {
    await octokit.repos.createCommitComment({
      owner: finding.repo.owner,
      repo: finding.repo.name,
      commit_sha: finding.ref.commit,
      body: message,
    });
  }
}

async function executeNotify(ctx: ActionContext): Promise<void> {
  if (!ctx.snsTopicArn) return;

  const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns');
  const sns = new SNSClient({});
  await sns.send(
    new PublishCommand({
      TopicArn: ctx.snsTopicArn,
      Subject: `[${ctx.finding.severity.toUpperCase()}] ${ctx.finding.title}`,
      Message: JSON.stringify({
        severity: ctx.finding.severity,
        title: ctx.finding.title,
        repo: `${ctx.finding.repo.owner}/${ctx.finding.repo.name}`,
        tool: ctx.finding.tool,
        url: ctx.finding.htmlUrl,
      }),
    }),
  );
}

async function executeAnnotate(ctx: ActionContext): Promise<void> {
  const { octokit, finding } = ctx;
  if (!finding.ref?.commit) return;

  await octokit.checks.create({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    name: 'ai3-mvp/security',
    head_sha: finding.ref.commit,
    status: 'completed',
    conclusion: 'neutral',
    output: {
      title: `Security: ${finding.title}`,
      summary: finding.body,
    },
  });
}

const ACTION_EXECUTORS: Record<
  ActionType,
  (ctx: ActionContext) => Promise<void>
> = {
  block: executeBlock,
  issue: executeIssue,
  comment: executeComment,
  notify: executeNotify,
  annotate: executeAnnotate,
  ignore: async () => {},
};

export async function executeActions(
  actions: ActionType[],
  ctx: ActionContext,
): Promise<void> {
  const resolved = resolveConflicts(actions);
  for (const action of resolved) {
    try {
      await ACTION_EXECUTORS[action](ctx);
    } catch (err) {
      console.error('Action failed', {
        action,
        finding: ctx.finding.title,
        error: err,
      });
    }
  }
}
