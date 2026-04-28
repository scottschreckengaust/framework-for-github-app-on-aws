import { SQSEvent } from 'aws-lambda';

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    console.error(
      JSON.stringify({
        alert: 'DLQ_EVENT',
        messageId: record.messageId,
        body: record.body,
      }),
    );
  }
};
