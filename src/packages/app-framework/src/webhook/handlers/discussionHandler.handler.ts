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
  publishEventProcessed({
    appId: (event.detail as any).installation?.app_id,
    orgName: (event.detail as any).organization?.login,
    eventType: event['detail-type'],
    handlerName: 'discussionHandler',
  });
  console.log(
    JSON.stringify({
      handler: 'discussionHandler',
      eventType: event['detail-type'],
      deliveryId: event.detail.delivery_id,
      action: event.detail.action,
      sender: event.detail.sender?.login,
      repo: event.detail.repository?.full_name,
      discussionTitle: (
        event.detail.payload.discussion as { title: string } | undefined
      )?.title,
    }),
  );
};
