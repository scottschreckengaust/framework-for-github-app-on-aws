import { Octokit } from '@octokit/rest';
import { executeActions, executeLifecycle } from './actions';
import { Severity, resolveConfig, getActionsForSeverity } from './config';
import { getInstallationToken } from './getInstallationToken';
import { SecurityFinding, DismissalInfo } from './types';
import { isAlreadyProcessed } from '../../utils/idempotency';
import {
  publishEventProcessed,
  publishError,
  EventMetricContext,
} from '../../utils/metrics';

// prettier-ignore
interface DependabotEvent {
  'detail-type': string;
  'detail': {
    delivery_id: string;
    action: string;
    installation?: { id: number };
    organization?: { login: string };
    repository: { full_name: string };
    sender?: { login: string };
    payload: {
      alert: {
        number: number;
        state: string;
        html_url: string;
        dismissed_by?: { login: string } | null;
        dismissed_at?: string | null;
        dismissed_reason?: string | null;
        dismissed_comment?: string | null;
        dependency: {
          package: { ecosystem: string; name: string };
          manifest_path: string;
        };
        security_vulnerability: {
          severity: string;
          vulnerable_version_range: string;
        };
        security_advisory: {
          summary: string;
          description: string;
          cve_id: string | null;
          ghsa_id: string;
        };
      };
    };
  };
}

const HANDLER_NAME = 'dependabotHandler';

const ACTIVE_ACTIONS = ['created', 'reopened', 'reintroduced', 'auto_reopened'];
const RESOLVE_ACTIONS = ['fixed', 'auto_dismissed'];
const DISMISS_ACTIONS = ['dismissed'];

function mapSeverity(depSeverity: string): Severity {
  switch (depSeverity.toLowerCase()) {
    case 'critical':
      return 'critical';
    case 'high':
      return 'high';
    case 'medium':
      return 'medium';
    default:
      return 'low';
  }
}

export const handler = async (event: DependabotEvent): Promise<void> => {
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

  const token = await getInstallationToken();
  if (!token) {
    console.error('No installation token available', { handler: HANDLER_NAME });
    publishError(metricCtx);
    return;
  }

  const octokit = new Octokit({ auth: token });
  const alert = detail.payload.alert;
  const severity = mapSeverity(alert.security_vulnerability.severity);
  const advisory = alert.security_advisory;

  const finding: SecurityFinding = {
    severity,
    title: `${alert.dependency.package.name}: ${advisory.summary}`,
    body: [
      `**Package:** \`${alert.dependency.package.name}\` (${alert.dependency.package.ecosystem})`,
      `**Manifest:** \`${alert.dependency.manifest_path}\``,
      `**Vulnerable range:** ${alert.security_vulnerability.vulnerable_version_range}`,
      `**Advisory:** ${advisory.cve_id || advisory.ghsa_id}`,
      '',
      advisory.description.length > 500
        ? advisory.description.slice(0, 500) + '...'
        : advisory.description,
    ].join('\n'),
    htmlUrl: alert.html_url,
    repo: { owner, name: repo },
    alertNumber: alert.number,
    tool: 'Dependabot',
    source: HANDLER_NAME,
  };

  if (ACTIVE_ACTIONS.includes(detail.action)) {
    const config = await resolveConfig(octokit, owner, repo, 'dependabot');
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
        package: alert.dependency.package.name,
        severity: finding.severity,
        actions,
      }),
    );
  } else if (RESOLVE_ACTIONS.includes(detail.action)) {
    await executeLifecycle('resolved', { octokit, finding });
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        deliveryId: detail.delivery_id,
        alertNumber: alert.number,
        lifecycle: 'resolved',
      }),
    );
  } else if (DISMISS_ACTIONS.includes(detail.action)) {
    const dismissal: DismissalInfo = {
      dismissedBy: alert.dismissed_by?.login ?? detail.sender?.login ?? 'unknown',
      dismissedAt: alert.dismissed_at ?? new Date().toISOString(),
      reason: alert.dismissed_reason ?? 'No reason provided',
      comment: alert.dismissed_comment ?? undefined,
    };
    await executeLifecycle('dismissed', { octokit, finding, dismissal });
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        deliveryId: detail.delivery_id,
        alertNumber: alert.number,
        lifecycle: 'dismissed',
        dismissedBy: dismissal.dismissedBy,
        reason: dismissal.reason,
      }),
    );
  } else {
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        action: detail.action,
        skipped: true,
      }),
    );
  }
};
