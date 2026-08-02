import { createHash } from 'node:crypto';

import { gitOperationSchema, type GitOperation, type GitReceipt } from '../core/git-operation';
import { runCommandSpec } from '../infrastructure/bounded-command-runner';

import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';

const secretPattern =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:api[-_]?key|password|secret|token)\s*[:=]\s*[^\s]{8,})/iu;

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
    const root = this.files.workspaceRootUri(operation.rootKey);
    const before = await this.identity(root.fsPath, signal);
    let stagedDiffHash: string | undefined;
    if (operation.operation === 'commit') {
      const staged = await this.git(
        root.fsPath,
        ['diff', '--cached', '--no-ext-diff', '--binary'],
        signal,
      );
      if (secretPattern.test(staged)) throw new Error('Staged secret scan blocked the commit');
      stagedDiffHash = this.hash(staged);
      if (staged.trim().length === 0) throw new Error('Commit requires an explicitly staged diff');
      if (!(await this.reviewStagedDiff(staged, stagedDiffHash, signal)))
        throw new Error('Commit was not approved after staged-diff review');
    }
    const output = await this.git(root.fsPath, this.arguments(operation), signal);
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
    switch (operation.operation) {
      case 'create-branch':
        return ['branch', operation.branch, operation.startPoint ?? 'HEAD'];
      case 'create-worktree':
        return [
          'worktree',
          'add',
          '-b',
          operation.branch,
          operation.path,
          operation.startPoint ?? 'HEAD',
        ];
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
