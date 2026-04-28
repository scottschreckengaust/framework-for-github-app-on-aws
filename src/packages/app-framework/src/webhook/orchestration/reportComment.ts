export interface PostCommentInput {
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}

export interface UpdateCommentInput {
  token: string;
  owner: string;
  repo: string;
  commentId: number;
  body: string;
}

export async function postComment(input: PostCommentInput): Promise<number> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: input.body }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to post comment: ${resp.status}`);
  }
  const data = (await resp.json()) as { id: number };
  return data.id;
}

export async function updateComment(input: UpdateCommentInput): Promise<void> {
  const resp = await fetch(
    `https://api.github.com/repos/${input.owner}/${input.repo}/issues/comments/${input.commentId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: input.body }),
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to update comment: ${resp.status}`);
  }
}
