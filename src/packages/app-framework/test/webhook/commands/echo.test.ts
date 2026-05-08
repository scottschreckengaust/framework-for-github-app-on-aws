import { handleEcho } from '../../../src/webhook/handlers/commands/echo';
import { CommandContext } from '../../../src/webhook/handlers/commands/types';

jest.mock('../../../src/webhook/orchestration/reportComment', () => ({
  postComment: jest.fn().mockResolvedValue(456),
}));

import { postComment } from '../../../src/webhook/orchestration/reportComment';

const mockPostComment = postComment as jest.MockedFunction<typeof postComment>;

beforeEach(() => {
  jest.clearAllMocks();
});

const baseCtx: CommandContext = {
  args: '',
  token: 'tok-abc',
  owner: 'myowner',
  repo: 'myrepo',
  issueNumber: 7,
  sender: 'alice',
  userId: 1,
};

describe('handleEcho', () => {
  it('posts args when ctx.args is truthy', async () => {
    const ctx = { ...baseCtx, args: 'hello world' };
    await handleEcho(ctx);

    expect(mockPostComment).toHaveBeenCalledWith({
      token: 'tok-abc',
      owner: 'myowner',
      repo: 'myrepo',
      issueNumber: 7,
      body: '@alice hello world',
    });
  });

  it('posts (empty) when ctx.args is falsy', async () => {
    await handleEcho(baseCtx);

    expect(mockPostComment).toHaveBeenCalledWith({
      token: 'tok-abc',
      owner: 'myowner',
      repo: 'myrepo',
      issueNumber: 7,
      body: '@alice (empty)',
    });
  });
});
