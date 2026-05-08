import { handleCheck } from '../../../src/webhook/handlers/commands/check';
import { CommandContext } from '../../../src/webhook/handlers/commands/types';

jest.mock('../../../src/webhook/orchestration/reportComment', () => ({
  postComment: jest.fn().mockResolvedValue(123),
}));

jest.mock('../../../src/webhook/orchestration/startExecution', () => ({
  startExecution: jest
    .fn()
    .mockResolvedValue({ jobId: 'job-123', executionArn: 'arn:exec' }),
}));

import { postComment } from '../../../src/webhook/orchestration/reportComment';
import { startExecution } from '../../../src/webhook/orchestration/startExecution';

const mockPostComment = postComment as jest.MockedFunction<typeof postComment>;
const mockStartExecution = startExecution as jest.MockedFunction<
  typeof startExecution
>;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.CI_CHECK_STATE_MACHINE_ARN;
});

const baseCtx: CommandContext = {
  args: '',
  token: 'tok-123',
  owner: 'test-owner',
  repo: 'test-repo',
  issueNumber: 42,
  sender: 'testuser',
  userId: 99,
};

describe('handleCheck', () => {
  it('posts not-configured message when CI_CHECK_STATE_MACHINE_ARN is not set', async () => {
    await handleCheck(baseCtx);

    expect(mockPostComment).toHaveBeenCalledWith({
      token: 'tok-123',
      owner: 'test-owner',
      repo: 'test-repo',
      issueNumber: 42,
      body: '@testuser CI Check workflow is not configured.',
    });
    expect(mockStartExecution).not.toHaveBeenCalled();
  });

  it('uses ctx.args as headSha when args is provided', async () => {
    process.env.CI_CHECK_STATE_MACHINE_ARN =
      'arn:aws:states:us-east-1:123:stateMachine:check';

    const ctx = { ...baseCtx, args: 'abc123' };
    await handleCheck(ctx);

    expect(mockStartExecution).toHaveBeenCalledWith({
      stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:check',
      input: {
        owner: 'test-owner',
        repo: 'test-repo',
        headSha: 'abc123',
        userId: 99,
      },
      userId: 99,
      repoFullName: 'test-owner/test-repo',
    });
    expect(mockPostComment).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '@testuser CI Check started (Job: job-123). Check the Checks tab for progress.',
      }),
    );
  });

  it('uses HEAD as headSha when args is empty', async () => {
    process.env.CI_CHECK_STATE_MACHINE_ARN =
      'arn:aws:states:us-east-1:123:stateMachine:check';

    await handleCheck(baseCtx);

    expect(mockStartExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          headSha: 'HEAD',
        }),
      }),
    );
  });
});
