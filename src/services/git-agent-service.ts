import { createHash } from 'node:crypto';
import path from 'node:path';

import { gitOperationSchema, type GitOperation, type GitReceipt } from '../core/git-operation';
import { assessPullRequestReadiness, describeReadiness } from '../core/pull-request-readiness';
import { findStagedSecret } from '../core/staged-secret-scan';
import { advertisedWorkspaceRootIndex } from '../core/workspace-scope';
import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type { PullRequestFacts } from '../core/pull-request-readiness.types';
import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';

export class GitAgentService {
  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly reviewStagedDiff: (
      diff: string,
      hash: string,
      signal?: AbortSignal,
    ) => Promise<boolean>,
  ) {}

  async execute(candidate: unknown, signal?: AbortSignal): Promise<GitReceipt> {
    const operation = gitOperationSchema.parse(candidate);
    // A sub-agent's own scoped executor deliberately shadows an advertised
    // `workspace-N` key with its worktree, and that is safe there: every
    // call the sub-agent makes is bound to its own worktreeId. The main
    // session has no such bound — a `workspace-N` collision here would
    // silently redirect every later ordinary call using that key, not just
    // this one caller's.
    if (
      operation.operation === 'create-worktree' &&
      advertisedWorkspaceRootIndex(operation.newRootKey) !== undefined
    ) {
      throw new Error('newRootKey cannot reuse an advertised workspace folder key');
    }
    const root = this.files.workspaceRootUri(operation.rootKey);
    const before = await this.identity(root.fsPath, signal);
    let stagedDiffHash: string | undefined;
    if (operation.operation === 'commit') {
      const staged = await this.git(
        root.fsPath,
        ['diff', '--cached', '--no-ext-diff', '--binary'],
        signal,
      );
      const leaked = findStagedSecret(staged);
      if (leaked !== undefined)
        throw new Error(
          `Staged secret scan blocked the commit: an added line assigns what looks like a live credential (${leaked.slice(0, 12)}…). Remove it, or move it to an environment variable, then stage again.`,
        );
      stagedDiffHash = this.hash(staged);
      if (staged.trim().length === 0) throw new Error('Commit requires an explicitly staged diff');
      if (!(await this.reviewStagedDiff(staged, stagedDiffHash, signal)))
        throw new Error('Commit was not approved after staged-diff review');
    }
    if (operation.operation === 'pr-readiness') {
      // Answered rather than run: this is the one operation that asks a
      // question about the repository instead of changing or printing it.
      return this.pullRequestReceipt(root.fsPath, operation.baseBranch, before, signal);
    }
    const output = await this.git(root.fsPath, this.arguments(operation), signal);
    // Only after the command actually succeeds: a worktree that failed to
    // create must not become addressable, and one that failed to remove
    // must stay addressable.
    if (operation.operation === 'create-worktree') {
      this.files.registerRuntimeRoot(
        operation.newRootKey,
        path.resolve(root.fsPath, operation.path),
      );
    }
    if (operation.operation === 'remove-worktree') {
      this.files.unregisterRuntimeRoot(operation.worktreeRootKey);
    }
    const after = await this.identity(root.fsPath, signal);
    return {
      operation: operation.operation,
      beforeHead: before.head,
      afterHead: after.head,
      beforeWorkingTreeHash: before.workingTreeHash,
      afterWorkingTreeHash: after.workingTreeHash,
      ...(stagedDiffHash === undefined ? {} : { stagedDiffHash }),
      ...(operation.operation === 'push' ? { pushedRef: operation.refspec } : {}),
      output: output.slice(0, 1_048_576),
    };
  }

  /**
   * What git already knows about whether this branch could open a pull request.
   *
   * Every fact here is one an agent otherwise discovers by trying: it pushes,
   * fails, and spends model turns learning that the repository has no remote or
   * that it is sitting on the base branch. Gathering them costs five cheap
   * reads.
   *
   * A failed read is treated as the absence of the thing it looked for, not as
   * an error. `rev-list` against a base that does not exist locally fails, and
   * the honest reading of that is "nothing is ahead of a base I cannot see" —
   * which the caller is then told, rather than being handed a git error to
   * interpret.
   */
  private async pullRequestReceipt(
    cwd: string,
    baseBranch: string | undefined,
    before: { head: string | null; workingTreeHash: string },
    signal?: AbortSignal,
  ): Promise<GitReceipt> {
    const currentBranch = (await this.safeGit(cwd, ['branch', '--show-current'], signal)).trim();
    const base = baseBranch ?? (await this.defaultBase(cwd, signal));
    const remotes = (await this.safeGit(cwd, ['remote'], signal))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const counts = (
      await this.safeGit(cwd, ['rev-list', '--left-right', '--count', `${base}...HEAD`], signal)
    )
      .trim()
      .split(/\s+/u)
      .map((value) => Number.parseInt(value, 10));
    const dirtyPaths = (await this.safeGit(cwd, ['status', '--porcelain'], signal))
      .split(/\r?\n/u)
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0);
    const upstream = (
      await this.safeGit(cwd, ['rev-parse', '--abbrev-ref', '@{upstream}'], signal)
    ).trim();
    const facts: PullRequestFacts = {
      currentBranch,
      baseBranch: base,
      remotes,
      behindBy: Number.isFinite(counts[0]) ? (counts[0] ?? 0) : 0,
      aheadBy: Number.isFinite(counts[1]) ? (counts[1] ?? 0) : 0,
      dirtyPaths,
      hasUpstream: upstream.length > 0,
    };
    const readiness = assessPullRequestReadiness(facts);
    return {
      operation: 'pr-readiness',
      beforeHead: before.head,
      afterHead: before.head,
      beforeWorkingTreeHash: before.workingTreeHash,
      afterWorkingTreeHash: before.workingTreeHash,
      output: describeReadiness(readiness, facts),
      pullRequest: { ...readiness, facts },
    };
  }

  /** The base a pull request would target when the caller named none. */
  private async defaultBase(cwd: string, signal?: AbortSignal): Promise<string> {
    const head = (
      await this.safeGit(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], signal)
    ).trim();
    return head.length === 0 ? 'main' : head.replace(/^origin\//u, '');
  }

  /** A read whose failure is an answer rather than an error. */
  private async safeGit(cwd: string, arguments_: string[], signal?: AbortSignal): Promise<string> {
    try {
      return await this.git(cwd, arguments_, signal);
    } catch {
      return '';
    }
  }

  async abortCherryPick(rootKey: string, signal?: AbortSignal): Promise<void> {
    const root = this.files.workspaceRootUri(rootKey);
    await this.git(root.fsPath, ['cherry-pick', '--abort'], signal);
  }

  async verifyCommit(
    rootKey: string,
    commit: string,
    declaredPaths: readonly string[],
    signal?: AbortSignal,
  ): Promise<boolean> {
    const operation = gitOperationSchema.parse({ rootKey, operation: 'log', ref: commit });
    const root = this.files.workspaceRootUri(operation.rootKey);
    try {
      await this.git(root.fsPath, ['cat-file', '-e', `${commit}^{commit}`], signal);
      await this.git(root.fsPath, ['merge-base', '--is-ancestor', commit, 'HEAD'], signal);
      const output = await this.git(
        root.fsPath,
        ['diff-tree', '--no-commit-id', '--name-only', '-r', commit],
        signal,
      );
      const actual = output
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean)
        .sort();
      const declared = [...declaredPaths].sort();
      return JSON.stringify(actual) === JSON.stringify(declared);
    } catch {
      return false;
    }
  }

  private arguments(operation: GitOperation): string[] {
    const readOperations = new Set([
      'status',
      'diff',
      'log',
      'blame',
      'branches',
      'tags',
      'remotes',
      'worktrees',
      'conflicts',
      'submodules',
      'topology',
    ]);
    const publicationOperations = new Set(['fetch', 'pull', 'push', 'tag']);
    if (readOperations.has(operation.operation)) return this.readArguments(operation);
    if (publicationOperations.has(operation.operation)) return this.publicationArguments(operation);
    return this.mutationArguments(operation);
  }

  private readArguments(operation: GitOperation): string[] {
    const focused = new Set(['diff', 'log', 'blame']);
    return focused.has(operation.operation)
      ? this.focusedReadArguments(operation)
      : this.simpleReadArguments(operation);
  }

  private focusedReadArguments(operation: GitOperation): string[] {
    switch (operation.operation) {
      case 'diff':
        return [
          'diff',
          '--no-ext-diff',
          ...(operation.ref === undefined ? [] : [operation.ref]),
          '--',
          ...(operation.path === undefined ? [] : [operation.path]),
        ];
      case 'log':
        return [
          'log',
          '--decorate=short',
          '--oneline',
          '--max-count=200',
          ...(operation.ref === undefined ? [] : [operation.ref]),
        ];
      case 'blame':
        return ['blame', '--line-porcelain', operation.ref ?? 'HEAD', '--', operation.path ?? '.'];
      default:
        throw new Error('Unsupported focused Git read operation');
    }
  }

  private simpleReadArguments(operation: GitOperation): string[] {
    switch (operation.operation) {
      case 'status':
        return ['status', '--porcelain=v2', '--branch'];
      case 'branches':
        return ['branch', '--all', '--verbose', '--no-abbrev'];
      case 'tags':
        return ['tag', '--list', '--format=%(refname:short) %(objectname)'];
      case 'remotes':
        return ['remote', '--verbose'];
      case 'worktrees':
        return ['worktree', 'list', '--porcelain'];
      case 'conflicts':
        return ['diff', '--name-only', '--diff-filter=U'];
      case 'submodules':
        return ['submodule', 'status', '--recursive'];
      case 'topology':
        return ['rev-list', '--all', '--parents', '--max-count=1000'];
      default:
        throw new Error('Unsupported Git read operation');
    }
  }

  private mutationArguments(operation: GitOperation): string[] {
    const history = new Set(['merge', 'rebase', 'cherry-pick', 'revert']);
    return history.has(operation.operation)
      ? this.historyMutationArguments(operation)
      : this.workspaceMutationArguments(operation);
  }

  private workspaceMutationArguments(operation: GitOperation): string[] {
    if (operation.operation === 'create-worktree' || operation.operation === 'remove-worktree') {
      return this.worktreeMutationArguments(operation);
    }
    switch (operation.operation) {
      case 'create-branch':
        return ['branch', operation.branch, operation.startPoint ?? 'HEAD'];
      case 'stage':
        return ['add', '--', ...operation.paths];
      case 'unstage':
        return ['restore', '--staged', '--', ...operation.paths];
      case 'commit':
        return ['commit', ...(operation.amend ? ['--amend'] : []), '-m', operation.message];
      case 'stash':
        return [
          'stash',
          'push',
          ...(operation.includeUntracked ? ['--include-untracked'] : []),
          ...(operation.message === undefined ? [] : ['-m', operation.message]),
        ];
      default:
        throw new Error('Unsupported Git workspace mutation');
    }
  }

  private worktreeMutationArguments(
    operation: Extract<GitOperation, { operation: 'create-worktree' | 'remove-worktree' }>,
  ): string[] {
    if (operation.operation === 'create-worktree') {
      return [
        'worktree',
        'add',
        '-b',
        operation.branch,
        operation.path,
        operation.startPoint ?? 'HEAD',
      ];
    }
    return [
      'worktree',
      'remove',
      '--force',
      this.files.workspaceRootUri(operation.worktreeRootKey).fsPath,
    ];
  }

  private historyMutationArguments(operation: GitOperation): string[] {
    switch (operation.operation) {
      case 'merge':
        return ['merge', '--no-edit', operation.ref];
      case 'rebase':
        return ['rebase', operation.ref];
      case 'cherry-pick':
        return ['cherry-pick', operation.ref];
      case 'revert':
        return ['revert', '--no-edit', operation.ref];
      default:
        throw new Error('Unsupported Git history mutation');
    }
  }

  private publicationArguments(operation: GitOperation): string[] {
    switch (operation.operation) {
      case 'fetch':
        return ['fetch', operation.remote, ...(operation.ref === undefined ? [] : [operation.ref])];
      case 'pull':
        return ['pull', '--ff-only', operation.remote, operation.branch];
      case 'push':
        return [
          'push',
          ...(operation.forceWithLease === undefined
            ? []
            : [
                `--force-with-lease=${operation.forceWithLease.ref}:${operation.forceWithLease.expectedSha}`,
              ]),
          operation.remote,
          operation.refspec,
        ];
      case 'tag':
        return [
          'tag',
          ...(operation.message === undefined ? [] : ['-a', '-m', operation.message]),
          operation.name,
          operation.target ?? 'HEAD',
        ];
      default:
        throw new Error('Unsupported Git publication operation');
    }
  }

  private async identity(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ head: string | null; workingTreeHash: string }> {
    let head: string | null = null;
    try {
      head = (await this.git(cwd, ['rev-parse', 'HEAD'], signal)).trim();
    } catch {
      head = null;
    }
    const status = await this.git(
      cwd,
      ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
      signal,
    );
    return { head, workingTreeHash: this.hash(status) };
  }

  private async git(cwd: string, arguments_: string[], signal?: AbortSignal): Promise<string> {
    const result = await runCommandSpec(
      {
        executable: 'git',
        arguments: arguments_,
        cwdRootKey: 'internal',
        cwd: '.',
        environment: {},
        timeoutMs: 600_000,
        outputLimitBytes: 4_194_304,
        expectedEffect: 'local-mutation',
        targetId: 'target:workspace',
        elevation: false,
      },
      cwd,
      signal,
    );
    if (result.exitCode !== 0)
      throw new Error(result.stderr || `Git exited with ${String(result.exitCode)}`);
    return result.stdout;
  }

  private hash(value: string): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
  }
}
