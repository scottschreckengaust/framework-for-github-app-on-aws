import { handler } from './alertHandler.handler';

describe('alertHandler', () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
  afterEach(() => consoleSpy.mockClear());
  afterAll(() => consoleSpy.mockRestore());

  it('logs failed events from DLQ', async () => {
    const event = {
      Records: [
        {
          // prettier-ignore
          body: JSON.stringify({
            'source': 'github',
            'detail-type': 'push',
            'detail': { delivery_id: 'failed-1' },
          }),
          messageId: 'msg-1',
        },
      ],
    };
    await handler(event as any);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('failed-1'),
    );
  });
});
