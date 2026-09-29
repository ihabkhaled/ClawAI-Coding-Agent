import { redactText } from './redaction';
import {
  GITHUB_HOSTS,
  GITLAB_DEFAULT_HOST,
  GITLAB_MERGE_REQUEST_MARKER,
  MAX_REVIEW_COMMENT_LENGTH,
} from './review-target.constants';

import type { ReviewDraftPlan, ReviewTarget, ReviewTargetParse } from './review-target.types';

const GITHUB_PULL_PATH = /^\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?/;
const POSITIVE_INTEGER = /^\d+$/;

function parseGitHub(path: string): ReviewTarget | undefined {
  const match = GITHUB_PULL_PATH.exec(path);
  if (match === null) return undefined;
  const [, owner = '', repo = '', number = '0'] = match;
  const pullNumber = Number(number);
  return pullNumber > 0 ? { provider: 'GITHUB', owner, repo, pullNumber } : undefined;
}

function parseGitLab(host: string, path: string): ReviewTarget | undefined {
  const index = path.indexOf(GITLAB_MERGE_REQUEST_MARKER);
  if (index <= 1) return undefined;
  const projectPath = path.slice(1, index);
  const iidText = path.slice(index + GITLAB_MERGE_REQUEST_MARKER.length).split('/')[0] ?? '';
  if (!POSITIVE_INTEGER.test(iidText) || projectPath.split('/').length < 2) return undefined;
  const iid = Number(iidText);
  return iid > 0 ? { provider: 'GITLAB', host, projectPath, iid } : undefined;
}

/**
 * Reads a pull-request or merge-request link the person pasted.
 *
 * A link rather than the local git remote: the link names the exact review,
 * and the person copying it has already chosen it. Only HTTPS is accepted,
 * because the host decides which connector's token the server will spend.
 */
export function parseReviewTarget(input: string): ReviewTargetParse {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, refusal: 'invalid-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, refusal: 'not-https' };
  const host = url.hostname.toLowerCase();
  const target = GITHUB_HOSTS.includes(host)
    ? parseGitHub(url.pathname)
    : parseGitLab(host, url.pathname);
  return target === undefined ? { ok: false, refusal: 'unsupported' } : { ok: true, target };
}

/**
 * Builds the workspace-service action that posts one review comment.
 *
 * The body is redacted before it leaves the machine: a review comment is often
 * public, and a token pasted into it would be published under the person's name.
 */
export function planReviewComment(target: ReviewTarget, body: string): ReviewDraftPlan {
  const text = redactText(body.trim());
  if (text.length === 0) return { ok: false, refusal: 'empty' };
  if (text.length > MAX_REVIEW_COMMENT_LENGTH) return { ok: false, refusal: 'too-long' };
  if (target.provider === 'GITHUB') {
    return {
      ok: true,
      draft: {
        actionType: 'COMMENT_PR',
        payload: {
          owner: target.owner,
          repo: target.repo,
          pullNumber: target.pullNumber,
          body: text,
        },
      },
    };
  }
  const selfManaged =
    target.host === GITLAB_DEFAULT_HOST ? {} : { baseUrl: `https://${target.host}` };
  return {
    ok: true,
    draft: {
      actionType: 'CREATE_MR_COMMENT',
      payload: { projectId: target.projectPath, iid: target.iid, body: text, ...selfManaged },
    },
  };
}
