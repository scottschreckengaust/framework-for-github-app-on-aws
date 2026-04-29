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
