import { isAlreadyProcessed } from '../utils/idempotency';
import { publishEventProcessed } from '../utils/metrics';

// prettier-ignore
interface EventDetail {
  'detail-type': string;
  'detail': {
    delivery_id: string;
    action?: string;
    sender?: { login: string };
    repository?: { full_name: string };
    payload: Record<string, unknown>;
  };
}

export const handler = async (event: EventDetail): Promise<void> => {
  const isDuplicate = await isAlreadyProcessed(
    event.detail.delivery_id,
    'prHandler',
  );
  if (isDuplicate) return;

  publishEventProcessed({
    appId: (event.detail as any).installation?.id,
    orgName: (event.detail as any).organization?.login,
    eventType: event['detail-type'],
    handlerName: 'prHandler',
  });
  console.log(
    JSON.stringify({
      handler: 'prHandler',
      eventType: event['detail-type'],
      deliveryId: event.detail.delivery_id,
      action: event.detail.action,
      sender: event.detail.sender?.login,
      repo: event.detail.repository?.full_name,
      prNumber: (
        event.detail.payload.pull_request as { number: number } | undefined
      )?.number,
    }),
  );
};
