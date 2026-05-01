export const handler = async (event: {
  action: 'create' | 'complete';
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  checkRunId?: number;
  jobId: string;
}): Promise<{ checkRunId: number; jobId: string }> => {
  if (event.action === 'create') {
    const resp = await fetch(
      `https://api.github.com/repos/${event.owner}/${event.repo}/check-runs`,
      {
        method: 'POST',
        // prettier-ignore
        headers: {
          'Authorization': `Bearer ${event.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: 'ai3-mvp / CI Check',
          head_sha: event.headSha,
          status: 'in_progress',
          started_at: new Date().toISOString(),
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to create check run: ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as { id: number };
    console.log('Check run created', { checkRunId: data.id, jobId: event.jobId });
    return { checkRunId: data.id, jobId: event.jobId };
  }

  if (event.action === 'complete') {
    const resp = await fetch(
      `https://api.github.com/repos/${event.owner}/${event.repo}/check-runs/${event.checkRunId}`,
      {
        method: 'PATCH',
        // prettier-ignore
        headers: {
          'Authorization': `Bearer ${event.token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'completed',
          conclusion: 'success',
          completed_at: new Date().toISOString(),
          output: {
            title: 'CI Check Passed',
            summary: 'All checks completed successfully.',
          },
        }),
      },
    );
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Failed to complete check run: ${resp.status} ${text}`);
    }
    console.log('Check run completed', { checkRunId: event.checkRunId, jobId: event.jobId });
    return { checkRunId: event.checkRunId!, jobId: event.jobId };
  }

  throw new Error(`Unknown action: ${event.action}`);
};
