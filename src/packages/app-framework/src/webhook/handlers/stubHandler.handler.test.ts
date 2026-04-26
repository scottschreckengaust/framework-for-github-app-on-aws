import { handler } from './stubHandler.handler';

describe('stub event handler', () => {
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

  afterEach(() => consoleSpy.mockClear());
  afterAll(() => consoleSpy.mockRestore());

  it('logs the event type and delivery id', async () => {
    // prettier-ignore
    const event = {
      'source': 'github',
      'detail-type': 'issue_comment',
      'detail': {
        delivery_id: 'abc-123',
        action: 'created',
        sender: { login: 'testuser' },
        repository: { full_name: 'sbalswa/test-repo' },
      },
    };
    const result = await handler(event);
    expect(result).toEqual({ received: true });
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('issue_comment'),
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('abc-123'));
  });
});
