import { fetchWithRetry } from '../utils/fetchWithRetry';

export interface CreateCheckRunInput {
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out';
  output?: { title: string; summary: string };
}

export interface UpdateCheckRunInput {
  token: string;
  owner: string;
  repo: string;
  checkRunId: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion?: 'success' | 'failure' | 'cancelled' | 'timed_out';
  output?: { title: string; summary: string };
}

export async function createCheckRun(
  input: CreateCheckRunInput,
): Promise<number> {
  const resp = await fetchWithRetry(
    `https://api.github.com/repos/${input.owner}/${input.repo}/check-runs`,
    {
      method: 'POST',
      // prettier-ignore
      headers: {
        'Authorization': `Bearer ${input.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        head_sha: input.headSha,
        status: input.status,
        conclusion: input.conclusion,
        output: input.output,
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to create check run: ${resp.status}`);
  }
  const data = (await resp.json()) as { id: number };
  return data.id;
}

export async function updateCheckRun(
  input: UpdateCheckRunInput,
): Promise<void> {
  const resp = await fetchWithRetry(
    `https://api.github.com/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`,
    {
      method: 'PATCH',
      // prettier-ignore
      headers: {
        'Authorization': `Bearer ${input.token}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: input.status,
        conclusion: input.conclusion,
        output: input.output,
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to update check run: ${resp.status}`);
  }
}
