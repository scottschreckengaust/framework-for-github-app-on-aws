interface GitHubEventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: {
    delivery_id: string;
    action?: string;
    sender?: { login: string };
    repository?: { full_name: string };
    [key: string]: unknown;
  };
}

export const handler = async (
  event: GitHubEventBridgeEvent,
): Promise<{ received: boolean }> => {
  console.log(
    JSON.stringify({
      eventType: event['detail-type'],
      deliveryId: event.detail.delivery_id,
      action: event.detail.action,
      sender: event.detail.sender?.login,
      repo: event.detail.repository?.full_name,
    }),
  );
  return { received: true };
};
