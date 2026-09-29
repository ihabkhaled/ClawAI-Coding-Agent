import { createHash } from 'node:crypto';

import {
  actionsRunId,
  composePullRequestDraft,
  parsePullRequestUrl,
  summarizeChecks,
  tailOf,
} from '../core/pull-request';
import { MAX_FAILURE_RUNS } from '../core/pull-request.constants';
import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type {
  PullRequestDependencies,
  PullRequestDraftResult,
  PullRequestFailureReport,
  PullRequestPublishResult,
  PullRequestRequest,
} from './pull-request-service.types';
import type { CommandResult } from '../core/command-spec';
import type { GitReceipt } from '../core/git-operation';
import type { PullRequestCheckSummary } from '../core/pull-request.types';

/** A ref git will not read as an option, and that names nothing outside refs. */
const plainRef = /^(?!-)[A-Za-z0-9._/-]{1,200}$/u;

/**
 * Opening a pull request from the branch a run produced, and asking about it.
 *
 * GitHub is reached through the `gh` CLI the developer already signed in to,
 * not through a token this extension would have to hold. That keeps the
 * credential where the developer put it, and means the pull request is opened
 * as them, which is what a reviewer expects to see. When `gh` is missing or not
 * signed in the answer says so; nothing falls back to a weaker path.
 *
 * Every refusal is a result, not an exception: a branch that is not ready, a
 * pull request that already exists and a declined approval are three different
 * things for the model to do next.
 */
export class PullRequestService {
  constructor(private readonly dependencies: PullRequestDependencies) {}

  async draft(request: PullRequestRequest, signal?: AbortSignal): Promise<PullRequestDraftResult> {
    const receipt = await this.readiness(request, signal);
    const facts = this.facts(receipt);
    const cwd = this.cwd(request.rootKey);
    const base = this.ref(facts.baseBranch);
    const [subjects, paths] = await Promise.all([
      this.lines(cwd, ['log', '--reverse', '--format=%s', `${base}..HEAD`], signal),
      this.lines(cwd, ['diff', '--name-only', `${base}...HEAD`], signal),
    ]);
    // Uncommitted paths count too: the draft is also where the commit message
    // for them comes from.
    const changedPaths = [...new Set([...paths, ...facts.dirtyPaths])].sort();
    return {
      draft: composePullRequestDraft({
        branch: facts.currentBranch,
        baseBranch: facts.baseBranch,
        commitSubjects: subjects,
        changedPaths,
        ...(request.title === undefined ? {} : { title: request.title }),
        ...(request.summary === undefined ? {} : { summary: request.summary }),
        ...(request.type === undefined ? {} : { type: request.type }),
      }),
      branch: facts.currentBranch,
      baseBranch: facts.baseBranch,
      ready: receipt.pullRequest?.ready ?? false,
      blockers: receipt.pullRequest?.blockers ?? [],
    };
  }

  /**
   * Pushes the branch when that is all that is missing, then opens the pull
   * request — after the person has read the exact title and description.
   */
  async publish(
    request: PullRequestRequest,
    signal?: AbortSignal,
  ): Promise<PullRequestPublishResult> {
    const prepared = await this.draft(request, signal);
    const blocking = prepared.blockers.filter((blocker) => blocker !== 'not-pushed');
    if (blocking.length > 0) {
      return {
        published: false,
        reason: 'not-ready',
        detail: 'Resolve the blockers in order, then publish again.',
        blockers: blocking,
      };
    }
    const cwd = this.cwd(request.rootKey);
    if (!(await this.ghSignedIn(cwd, signal))) {
      return {
        published: false,
        reason: 'gh-unavailable',
        detail:
          'The GitHub CLI (gh) is not installed or not signed in. Run `gh auth login`, then publish again.',
      };
    }
    const push = prepared.blockers.includes('not-pushed');
    const { title, body } = prepared.draft;
    const preview = [
      `Title: ${title}`,
      `Base: ${prepared.baseBranch}  Head: ${prepared.branch}`,
      push ? `The branch ${prepared.branch} will be pushed first.` : '',
      '',
      body,
    ].join('\n');
    const hash = `sha256:${createHash('sha256').update(preview).digest('hex')}`;
    if (!(await this.dependencies.approve(preview, hash, signal))) {
      return { published: false, reason: 'not-approved', detail: 'The pull request was declined.' };
    }
    if (push) await this.push(request.rootKey, prepared.branch, signal);
    return this.create(request, prepared, push, signal);
  }

  async checks(
    rootKey: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestCheckSummary> {
    // gh exits non-zero while checks are pending or failing, and still prints
    // the JSON: the exit code is a verdict, not a failure to answer.
    const result = await this.run(
      'gh',
      ['pr', 'checks', String(number), '--json', 'name,bucket,link,workflow'],
      this.cwd(rootKey),
      signal,
    );
    try {
      return summarizeChecks(JSON.parse(result.stdout));
    } catch {
      if (/no checks reported/iu.test(result.stderr)) return summarizeChecks([]);
      throw new Error(tailOf(result.stderr || 'gh pr checks returned no JSON', 2_000));
    }
  }

  /** The failed-job logs of the Actions runs behind failing checks. */
  async failureLogs(
    rootKey: string,
    number: number,
    signal?: AbortSignal,
  ): Promise<PullRequestFailureReport> {
    const summary = await this.checks(rootKey, number, signal);
    const runs = [...new Set(summary.failing.map((check) => actionsRunId(check.link)))]
      .filter((id): id is string => id !== undefined)
      .slice(0, MAX_FAILURE_RUNS);
    const cwd = this.cwd(rootKey);
    const logs: string[] = [];
    for (const id of runs) {
      const result = await this.run('gh', ['run', 'view', id, '--log-failed'], cwd, signal);
      if (result.exitCode === 0 && result.stdout.trim().length > 0) {
        logs.push(`# Actions run ${id}\n${tailOf(result.stdout)}`);
      }
    }
    return { summary, logs: logs.join('\n\n') };
  }

  private async create(
    request: PullRequestRequest,
    prepared: PullRequestDraftResult,
    pushed: boolean,
    signal?: AbortSignal,
  ): Promise<PullRequestPublishResult> {
    const result = await this.run(
      'gh',
      [
        'pr',
        'create',
        '--base',
        this.ref(prepared.baseBranch),
        '--head',
        this.ref(prepared.branch),
        '--title',
        prepared.draft.title,
        '--body',
        prepared.draft.body,
        ...(request.draft === true ? ['--draft'] : []),
      ],
      this.cwd(request.rootKey),
      signal,
    );
    const opened = parsePullRequestUrl(result.stdout);
    if (result.exitCode === 0 && opened !== undefined) {
      this.dependencies.opened({ ...opened, rootKey: request.rootKey, branch: prepared.branch });
      return { published: true, ...opened, title: prepared.draft.title, pushed };
    }
    const existing = parsePullRequestUrl(result.stderr);
    if (existing !== undefined && /already exists/iu.test(result.stderr)) {
      return {
        published: false,
        reason: 'exists',
        detail: 'A pull request for this branch is already open.',
        url: existing.url,
      };
    }
    return {
      published: false,
      reason: 'failed',
      detail: tailOf(result.stderr || result.stdout || 'gh pr create failed', 2_000),
    };
  }

  private async push(rootKey: string, branch: string, signal?: AbortSignal): Promise<void> {
    const receipt = await this.dependencies.git.execute({ rootKey, operation: 'remotes' }, signal);
    const remote = /^origin\s/mu.test(receipt.output)
      ? 'origin'
      : (receipt.output.split(/\s/u)[0] ?? 'origin');
    await this.dependencies.git.execute(
      { rootKey, operation: 'push', remote, refspec: branch },
      signal,
    );
  }

  private readiness(request: PullRequestRequest, signal?: AbortSignal): Promise<GitReceipt> {
    return this.dependencies.git.execute(
      {
        rootKey: request.rootKey,
        operation: 'pr-readiness',
        ...(request.baseBranch === undefined ? {} : { baseBranch: request.baseBranch }),
      },
      signal,
    );
  }

  private facts(receipt: GitReceipt) {
    if (receipt.pullRequest === undefined)
      throw new Error('Pull request readiness was not answered');
    return receipt.pullRequest.facts;
  }

  private ref(value: string): string {
    if (!plainRef.test(value) || value.includes('..')) throw new Error(`Unsafe ref: ${value}`);
    return value;
  }

  private cwd(rootKey: string): string {
    return this.dependencies.files.workspaceRootUri(rootKey).fsPath;
  }

  private async ghSignedIn(cwd: string, signal?: AbortSignal): Promise<boolean> {
    try {
      return (await this.run('gh', ['auth', 'status'], cwd, signal)).exitCode === 0;
    } catch {
      // Not on PATH is the same answer as not signed in: gh cannot open it.
      return false;
    }
  }

  private async lines(cwd: string, args: string[], signal?: AbortSignal): Promise<string[]> {
    const result = await this.run('git', args, cwd, signal);
    if (result.exitCode !== 0) return [];
    return result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private run(
    executable: string,
    args: string[],
    cwd: string,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    return runCommandSpec(
      {
        executable,
        arguments: args,
        cwdRootKey: 'internal',
        cwd: '.',
        environment: {},
        timeoutMs: 120_000,
        outputLimitBytes: 4_194_304,
        expectedEffect: 'network',
        targetId: 'target:workspace',
        elevation: false,
      },
      cwd,
      signal,
    );
  }
}
