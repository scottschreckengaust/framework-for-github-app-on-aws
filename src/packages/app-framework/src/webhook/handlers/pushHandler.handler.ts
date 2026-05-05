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
    'pushHandler',
  );
  if (isDuplicate) return;

  publishEventProcessed({
    appId: (event.detail as any).installation?.id,
    orgName: (event.detail as any).organization?.login,
    eventType: event['detail-type'],
    handlerName: 'pushHandler',
  });
  console.log(
    JSON.stringify({
      handler: 'pushHandler',
      eventType: event['detail-type'],
      deliveryId: event.detail.delivery_id,
      sender: event.detail.sender?.login,
      repo: event.detail.repository?.full_name,
      ref: event.detail.payload.ref,
      commitsCount: (event.detail.payload.commits as unknown[] | undefined)
        ?.length,
    }),
  );
};
