import { describe, expect, it } from 'vitest';

import { parseReviewTarget, planReviewComment } from '../../src/core/review-target';

describe('parseReviewTarget', () => {
  it('reads a GitHub pull request link', () => {
    expect(parseReviewTarget('https://github.com/acme/api/pull/42/files')).toEqual({
      ok: true,
      target: { provider: 'GITHUB', owner: 'acme', repo: 'api', pullNumber: 42 },
    });
  });

  it('reads a nested GitLab merge request link on a self-managed host', () => {
    expect(
      parseReviewTarget('https://git.example.org/group/sub/app/-/merge_requests/7/diffs'),
    ).toEqual({
      ok: true,
      target: { provider: 'GITLAB', host: 'git.example.org', projectPath: 'group/sub/app', iid: 7 },
    });
  });

  it('refuses http, garbage and links that are not a review', () => {
    expect(parseReviewTarget('http://github.com/a/b/pull/1')).toEqual({
      ok: false,
      refusal: 'not-https',
    });
    expect(parseReviewTarget('not a url')).toEqual({ ok: false, refusal: 'invalid-url' });
    expect(parseReviewTarget('https://github.com/a/b/issues/1')).toEqual({
      ok: false,
      refusal: 'unsupported',
    });
    expect(parseReviewTarget('https://github.com/a/b/pull/0')).toEqual({
      ok: false,
      refusal: 'unsupported',
    });
    expect(parseReviewTarget('https://gitlab.com/solo/-/merge_requests/3')).toEqual({
      ok: false,
      refusal: 'unsupported',
    });
  });
});

describe('planReviewComment', () => {
  it('drafts COMMENT_PR for GitHub with the redacted body', () => {
    const plan = planReviewComment(
      { provider: 'GITHUB', owner: 'acme', repo: 'api', pullNumber: 42 },
      '  Looks good. Authorization: Bearer abc.def.ghi  ',
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.draft.actionType).toBe('COMMENT_PR');
    expect(plan.draft.payload).toMatchObject({ owner: 'acme', repo: 'api', pullNumber: 42 });
    expect(String(plan.draft.payload.body)).not.toContain('abc.def.ghi');
  });

  it('drafts CREATE_MR_COMMENT, adding baseUrl only for a self-managed host', () => {
    const hosted = planReviewComment(
      { provider: 'GITLAB', host: 'gitlab.com', projectPath: 'g/app', iid: 3 },
      'nit',
    );
    const selfManaged = planReviewComment(
      { provider: 'GITLAB', host: 'git.example.org', projectPath: 'g/app', iid: 3 },
      'nit',
    );

    expect(hosted).toEqual({
      ok: true,
      draft: {
        actionType: 'CREATE_MR_COMMENT',
        payload: { projectId: 'g/app', iid: 3, body: 'nit' },
      },
    });
    expect(selfManaged.ok && selfManaged.draft.payload.baseUrl).toBe('https://git.example.org');
  });

  it('refuses an empty or oversized comment', () => {
    const target = { provider: 'GITHUB', owner: 'a', repo: 'b', pullNumber: 1 } as const;

    expect(planReviewComment(target, '   ')).toEqual({ ok: false, refusal: 'empty' });
    expect(planReviewComment(target, 'x'.repeat(10_001))).toEqual({
      ok: false,
      refusal: 'too-long',
    });
  });
});
