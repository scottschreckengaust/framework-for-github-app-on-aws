import { Octokit } from '@octokit/rest';
import { executeActions } from './actions';
import { resolveConfig, getActionsForSeverity } from './config';
import { getInstallationToken } from './getInstallationToken';
import { SecurityFinding } from './types';
import { isAlreadyProcessed } from '../../utils/idempotency';
import {
  publishEventProcessed,
  publishError,
  EventMetricContext,
} from '../../utils/metrics';

// prettier-ignore
interface SecretScanningEvent {
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
        secret_type: string;
        secret_type_display_name: string;
        state: string;
        html_url: string;
        push_protection_bypassed: boolean;
        resolution: string | null;
      };
    };
  };
}

const HANDLER_NAME = 'secretScanningHandler';

export const handler = async (event: SecretScanningEvent): Promise<void> => {
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

  if (detail.action !== 'created') {
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

  // Secret scanning is always critical severity
  const finding: SecurityFinding = {
    severity: 'critical',
    title: `Secret leaked: ${alert.secret_type_display_name}`,
    body: [
      `A ${alert.secret_type_display_name} (\`${alert.secret_type}\`) was detected.`,
      alert.push_protection_bypassed ? '**Push protection was bypassed.**' : '',
      '',
      'This secret must be revoked immediately.',
    ]
      .filter(Boolean)
      .join('\n'),
    htmlUrl: alert.html_url,
    repo: { owner, name: repo },
    alertNumber: alert.number,
    tool: 'GitHub Secret Scanning',
    source: HANDLER_NAME,
  };

  const config = await resolveConfig(octokit, owner, repo, 'secret_scanning');
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
      secretType: alert.secret_type,
      severity: finding.severity,
      actions,
    }),
  );
};
