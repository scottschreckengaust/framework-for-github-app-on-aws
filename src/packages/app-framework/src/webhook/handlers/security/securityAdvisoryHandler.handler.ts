import { Octokit } from '@octokit/rest';
import { executeActions } from './actions';
import { Severity, resolveConfig, getActionsForSeverity } from './config';
import { getInstallationToken } from './getInstallationToken';
import { SecurityFinding } from './types';
import { isAlreadyProcessed } from '../../utils/idempotency';
import { publishEventProcessed, EventMetricContext } from '../../utils/metrics';

// prettier-ignore
interface SecurityAdvisoryEvent {
  'detail-type': string;
  'detail': {
    delivery_id: string;
    action: string;
    installation?: { id: number };
    organization?: { login: string };
    repository?: { full_name: string };
    payload: {
      security_advisory: {
        ghsa_id: string;
        cve_id: string | null;
        summary: string;
        description: string;
        severity: string;
        html_url: string;
        vulnerabilities: Array<{
          package: { ecosystem: string; name: string };
          vulnerable_version_range: string;
        }>;
      };
    };
  };
}

const HANDLER_NAME = 'securityAdvisoryHandler';

function mapSeverity(advisorySeverity: string): Severity {
  switch (advisorySeverity.toLowerCase()) {
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

export const handler = async (event: SecurityAdvisoryEvent): Promise<void> => {
  const { detail } = event;

  const isDuplicate = await isAlreadyProcessed(
    detail.delivery_id,
    HANDLER_NAME,
  );
  if (isDuplicate) return;

  const repoFullName = detail.repository?.full_name;
  const [owner, repo] = repoFullName
    ? repoFullName.split('/')
    : ['unknown', 'unknown'];

  const metricCtx: EventMetricContext = {
    appId: process.env.APP_ID || detail.installation?.id,
    orgName: detail.organization?.login || owner,
    eventType: event['detail-type'],
    handlerName: HANDLER_NAME,
  };
  publishEventProcessed(metricCtx);

  if (detail.action !== 'published') {
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        action: detail.action,
        skipped: true,
      }),
    );
    return;
  }

  const advisory = detail.payload.security_advisory;
  const severity = mapSeverity(advisory.severity);

  const token = await getInstallationToken();
  if (!token) {
    // Advisory events are informational — log and return gracefully
    console.log(
      JSON.stringify({
        handler: HANDLER_NAME,
        deliveryId: detail.delivery_id,
        advisory: advisory.ghsa_id,
        severity,
        note: 'No token, logged only',
      }),
    );
    return;
  }

  const octokit = new Octokit({ auth: token });

  const affectedPackages = advisory.vulnerabilities
    .map(
      (v) =>
        `\`${v.package.name}\` (${v.package.ecosystem}) ${v.vulnerable_version_range}`,
    )
    .join('\n- ');

  const finding: SecurityFinding = {
    severity,
    title: `Advisory ${advisory.ghsa_id}: ${advisory.summary}`,
    body: [
      `**Advisory:** ${advisory.cve_id || advisory.ghsa_id}`,
      `**Severity:** ${advisory.severity}`,
      '',
      advisory.description.length > 500
        ? advisory.description.slice(0, 500) + '...'
        : advisory.description,
      '',
      affectedPackages ? `**Affected packages:**\n- ${affectedPackages}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    htmlUrl: advisory.html_url,
    repo: { owner, name: repo },
    tool: 'GitHub Security Advisory',
    source: HANDLER_NAME,
  };

  const config = await resolveConfig(octokit, owner, repo, 'security_advisory');
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
      advisory: advisory.ghsa_id,
      severity: finding.severity,
      actions,
    }),
  );
};
