import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { summarizeChecks, tailOf } from '../core/pull-request';
import { summarizePullRequest } from '../core/pull-request-actions';
import { PULL_REQUEST_VIEW_FIELDS } from '../core/pull-request-actions.constants';
import { redactText } from '../core/redaction';

import { runGitProcess } from './git-tools-run';
import { PR_DETAIL_CHARS, PR_GH_ENVIRONMENT, PR_GH_TIMEOUT_MS } from './pr-tool.constants';

import type { GitRunResult } from './git-tools.types';
import type { GhRunner } from './pr-tool.types';
import type { PullRequestView } from '../core/pull-request-actions.types';
import type { PullRequestCheckSummary } from '../core/pull-request.types';

/** The real runner: `gh`, no shell, a minimal environment, bounded output, killed on timeout or abort. */
export const runGh: GhRunner = (args, cwd, signal) =>
  runGitProcess(args, {
    executable: 'gh',
    cwd,
    environment: { ...inheritedEnvironment(env), ...PR_GH_ENVIRONMENT },
    timeoutMs: PR_GH_TIMEOUT_MS,
    signal,
  });

/** A refusal's detail: the error words of a failed run, redacted and bounded. */
export function failureDetail(result: GitRunResult, fallback: string): string {
  const text = result.stderr.trim() || result.stdout.trim() || fallback;
  return tailOf(redactText(text), PR_DETAIL_CHARS);
}

/** The pull request, bounded; undefined when `gh` failed or said something that is not one. */
export async function readPullRequest(
  run: GhRunner,
  number: number,
  cwd: string,
  signal?: AbortSignal,
): Promise<PullRequestView | undefined> {
  const result = await run(
    ['pr', 'view', String(number), '--json', PULL_REQUEST_VIEW_FIELDS],
    cwd,
    signal,
  );
  if (result.exitCode !== 0) return undefined;
  try {
    return summarizePullRequest(JSON.parse(result.stdout));
  } catch {
    return undefined;
  }
}

/** The check states. `gh` exits non-zero while checks fail or wait and still prints the JSON. */
export async function readChecks(
  run: GhRunner,
  number: number,
  cwd: string,
  signal?: AbortSignal,
): Promise<PullRequestCheckSummary | undefined> {
  const result = await run(
    ['pr', 'checks', String(number), '--json', 'name,bucket,link,workflow'],
    cwd,
    signal,
  );
  try {
    return summarizeChecks(JSON.parse(result.stdout));
  } catch {
    return /no checks reported/iu.test(result.stderr) ? summarizeChecks([]) : undefined;
  }
}
