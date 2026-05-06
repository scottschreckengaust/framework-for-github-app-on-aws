import { Octokit } from '@octokit/rest';
import { ActionType, resolveConflicts } from './config';
import { SecurityFinding, DismissalInfo, LifecycleAction } from './types';

export interface ActionContext {
  octokit: Octokit;
  finding: SecurityFinding;
  snsTopicArn?: string;
}

export interface LifecycleContext {
  octokit: Octokit;
  finding: SecurityFinding;
  dismissal?: DismissalInfo;
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

function issueLabels(finding: SecurityFinding): string[] {
  const labels = ['security'];
  if (finding.tool) labels.push(finding.tool);
  return labels;
}

function issueLabelsCSV(finding: SecurityFinding): string {
  return issueLabels(finding).join(',');
}

async function executeIssue(ctx: ActionContext): Promise<void> {
  const { octokit, finding } = ctx;
  const issueTitle = `[Security] ${finding.title}`;
  const labels = issueLabelsCSV(finding);

  const openIssues = await octokit.issues.listForRepo({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    state: 'open',
    labels,
    per_page: 100,
  });

  if (openIssues.data.find((i) => i.title === issueTitle)) return;

  const closedIssues = await octokit.issues.listForRepo({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    state: 'closed',
    labels,
    per_page: 100,
  });

  const previousIssue = closedIssues.data.find((i) => i.title === issueTitle);
  if (previousIssue) {
    await octokit.issues.update({
      owner: finding.repo.owner,
      repo: finding.repo.name,
      issue_number: previousIssue.number,
      state: 'open',
    });
    await octokit.issues.createComment({
      owner: finding.repo.owner,
      repo: finding.repo.name,
      issue_number: previousIssue.number,
      body: [
        ':rotating_light: **Alert reopened**',
        '',
        `This finding has reappeared. Severity: **${finding.severity}**`,
        '',
        `[View alert](${finding.htmlUrl})`,
      ].join('\n'),
    });
    return;
  }

  await octokit.issues.create({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    title: issueTitle,
    body: [
      `**Severity:** ${finding.severity}`,
      `**Tool:** ${finding.tool ?? 'Unknown'}`,
      `**Alert:** ${finding.htmlUrl}`,
      '',
      finding.body,
    ].join('\n'),
    labels: issueLabels(finding),
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

// --- Lifecycle actions (shared across all security handler types) ---

async function closeTrackingIssue(
  ctx: LifecycleContext,
  closeComment: string,
): Promise<void> {
  const { octokit, finding } = ctx;
  const issueTitle = `[Security] ${finding.title}`;

  const existing = await octokit.issues.listForRepo({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    state: 'open',
    labels: issueLabelsCSV(finding),
    per_page: 100,
  });

  const issue = existing.data.find((i) => i.title === issueTitle);
  if (!issue) return;

  await octokit.issues.createComment({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    issue_number: issue.number,
    body: closeComment,
  });

  await octokit.issues.update({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    issue_number: issue.number,
    state: 'closed',
    state_reason: 'completed',
  });
}

async function unblockCheckRun(ctx: LifecycleContext): Promise<void> {
  const { octokit, finding } = ctx;
  if (!finding.ref?.commit) return;

  await octokit.checks.create({
    owner: finding.repo.owner,
    repo: finding.repo.name,
    name: 'ai3-mvp/security',
    head_sha: finding.ref.commit,
    status: 'completed',
    conclusion: 'success',
    output: {
      title: 'Security: resolved',
      summary: `${finding.title} has been resolved.`,
    },
  });
}

export async function executeLifecycle(
  action: LifecycleAction,
  ctx: LifecycleContext,
): Promise<void> {
  try {
    switch (action) {
      case 'resolved': {
        await closeTrackingIssue(
          ctx,
          `:white_check_mark: **Resolved** — this finding is no longer present in the codebase.\n\n[View alert](${ctx.finding.htmlUrl})`,
        );
        await unblockCheckRun(ctx);
        break;
      }
      case 'dismissed': {
        const d = ctx.dismissal;
        const parts = [
          `:no_entry_sign: **Dismissed** by @${d?.dismissedBy ?? 'unknown'}`,
          `**Reason:** ${d?.reason ?? 'No reason provided'}`,
        ];
        if (d?.comment) {
          parts.push('', '**Comment**', '---', d.comment);
        }
        parts.push('', `[View alert](${ctx.finding.htmlUrl})`);
        await closeTrackingIssue(ctx, parts.join('\n'));
        await unblockCheckRun(ctx);
        break;
      }
      case 'appeared': {
        const { octokit, finding } = ctx;
        if (finding.ref?.pr) {
          await octokit.issues.createComment({
            owner: finding.repo.owner,
            repo: finding.repo.name,
            issue_number: finding.ref.pr,
            body: [
              ':information_source: **Existing security finding on this branch**',
              '',
              `**${finding.title}**`,
              `**Severity:** ${finding.severity} | **Tool:** ${finding.tool ?? 'Unknown'}`,
              '',
              `[View alert](${finding.htmlUrl})`,
            ].join('\n'),
          });
        }
        break;
      }
      case 'reopened': {
        // Treat same as new finding — delegate to executeActions with severity config
        break;
      }
    }
  } catch (err) {
    console.error('Lifecycle action failed', {
      action,
      finding: ctx.finding.title,
      error: err,
    });
  }
}
