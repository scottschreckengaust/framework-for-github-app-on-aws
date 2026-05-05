import { Octokit } from '@octokit/rest';
import { executeActions } from './actions';
import { Severity, resolveConfig, getActionsForSeverity } from './config';
import { getInstallationToken } from './getInstallationToken';
import { SecurityFinding } from './types';
import { isAlreadyProcessed } from '../../utils/idempotency';
import {
  publishEventProcessed,
  publishError,
  EventMetricContext,
} from '../../utils/metrics';

// prettier-ignore
interface CodeScanningEvent {
  'detail-type': string;
  'detail': {
    delivery_id: string;
    action: string;
    installation?: { id: number };
    organization?: { login: string };
    repository: { full_name: string };
    payload: {
      alert: {
        number: number;
        state: string;
        html_url: string;
        most_recent_instance?: {
          ref?: string;
          commit_sha?: string;
        };
        rule: {
          id: string;
          severity: string;
          description: string;
        };
        tool: {
          name: string;
          version: string | null;
        };
      };
      ref?: string;
      commit_oid?: string;
    };
  };
}

const HANDLER_NAME = 'codeScanningHandler';

function mapSeverity(ruleSeverity: string): Severity {
  switch (ruleSeverity.toLowerCase()) {
    case 'error':
    case 'critical':
      return 'critical';
    case 'warning':
    case 'high':
      return 'high';
    case 'note':
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
}

export const handler = async (event: CodeScanningEvent): Promise<void> => {
  const { detail } = event;

  const isDuplicate = await isAlreadyProcessed(
    detail.delivery_id,
    HANDLER_NAME,
  );
  if (isDuplicate) return;

  const [owner, repo] = detail.repository.full_name.split('/');
  const metricCtx: EventMetricContext = {
    appId: process.env.APP_ID || detail.installation?.id,
    orgName: detail.organization?.login || owner,
    eventType: event['detail-type'],
    handlerName: HANDLER_NAME,
  };
  publishEventProcessed(metricCtx);

  if (detail.action !== 'created' && detail.action !== 'reopened') {
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        action: detail.action,
        skipped: true,
      }),
    );
    return;
  }

  const token = await getInstallationToken();
  if (!token) {
    console.error('No installation token available', { handler: HANDLER_NAME });
    publishError(metricCtx);
    return;
  }

  const octokit = new Octokit({ auth: token });
  const alert = detail.payload.alert;
  const severity = mapSeverity(alert.rule.severity);

  const finding: SecurityFinding = {
    severity,
    title: `${alert.tool.name}: ${alert.rule.description}`,
    body: [
      `**Rule:** \`${alert.rule.id}\``,
      `**Tool:** ${alert.tool.name}${alert.tool.version ? ` v${alert.tool.version}` : ''}`,
      `**Severity:** ${alert.rule.severity} (mapped to ${severity})`,
    ].join('\n'),
    htmlUrl: alert.html_url,
    repo: { owner, name: repo },
    ref: {
      commit:
        alert.most_recent_instance?.commit_sha || detail.payload.commit_oid,
    },
    alertNumber: alert.number,
    tool: alert.tool.name,
    source: HANDLER_NAME,
  };

  const config = await resolveConfig(octokit, owner, repo, 'code_scanning');
  const actions = getActionsForSeverity(config, finding.severity);

  await executeActions(actions, {
    octokit,
    finding,
    snsTopicArn: process.env.SECURITY_SNS_TOPIC_ARN,
  });

  console.log(
    JSON.stringify({
      handler: HANDLER_NAME,
      deliveryId: detail.delivery_id,
      alertNumber: alert.number,
      tool: alert.tool.name,
      rule: alert.rule.id,
      severity: finding.severity,
      actions,
    }),
  );
};
