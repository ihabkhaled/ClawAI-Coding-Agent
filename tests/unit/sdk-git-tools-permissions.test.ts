import { afterEach, describe, expect, it } from 'vitest';

import { hardenedGitWriteArguments } from '../../src/core/git-hardening';
import { parseToolList } from '../../src/headless/headless-args';
import { prepareTrustedGitWriteSpawn } from '../../src/infrastructure/hardened-git';
import { commitMessage, explicitPaths, timeoutMilliseconds } from '../../src/sdk/git-tools-args';
import { needsApproval, permissionsForMode } from '../../src/sdk/permission-modes';
import { AGENT_ALL_TOOL_CATEGORIES } from '../../src/sdk/permission-modes.constants';
import {
  offeredDefinitions,
  toolCategory,
  workspaceToolkit,
} from '../../src/sdk/workspace-toolkit';

import { cleanUpRepositories, git, makeRepository, writeIn } from './sdk-git-tools.helpers';

import type { AgentToolCall } from '../../src/sdk/agent-sdk.types';
import type { AgentApprovalRequest } from '../../src/sdk/workspace-toolkit.types';

afterEach(cleanUpRepositories);

const call = (operation: string, args: Record<string, unknown> = {}): AgentToolCall => ({
  toolName: 'workspace.git',
  operation,
  arguments: args,
});
const request = (operation: string): AgentApprovalRequest => ({
  ...call(operation),
  category: toolCategory(call(operation)) ?? 'git-write',
});

const WRITES = ['add', 'unstage', 'commit', 'fetch', 'pull', 'push', 'switch', 'restore'];
const READS = ['status', 'diff', 'log', 'show', 'remote', 'branch'];

describe('git categories', () => {
  it('puts reads under git and every write under git-write, and nothing else exists', () => {
    for (const operation of READS) expect(toolCategory(call(operation))).toBe('git');
    for (const operation of WRITES) expect(toolCategory(call(operation))).toBe('git-write');
    for (const operation of ['reset', 'clean', 'checkout', 'stash', 'blame', 'rebase']) {
      expect(toolCategory(call(operation))).toBeUndefined();
    }
  });

  it('offers writes only when git-write is granted', () => {
    const operationsFor = (allow: Parameters<typeof offeredDefinitions>[0]): string[] => {
      const definitions = offeredDefinitions(allow) as { name: string; operations: string[] }[];
      return (
        definitions.find((definition) => definition.name === 'workspace.git')?.operations ?? []
      );
    };

    expect(operationsFor(['git'])).toEqual(READS);
    expect(operationsFor(['git-write'])).toEqual(WRITES);
    expect(operationsFor(['read'])).toEqual([]);
  });

  it('declares a closed input schema and the tool enforces the bounds the schema no longer sends', () => {
    const definitions = offeredDefinitions(['git', 'git-write']) as {
      name: string;
      inputSchema: unknown;
    }[];
    const schema = definitions.find(
      (definition) => definition.name === 'workspace.git',
    )?.inputSchema;

    expect(schema).toMatchObject({ additionalProperties: false });
    expect(() => commitMessage({ message: 'x'.repeat(101) })).toThrow(/at most 100/u);
    expect(() => explicitPaths('add', { paths: [] }, process.cwd())).toThrow(/non-empty/u);
    expect(() =>
      explicitPaths('add', { paths: Array<string>(101).fill('a.txt') }, process.cwd()),
    ).toThrow(/at most 100/u);
    expect(timeoutMilliseconds({ timeoutSeconds: 999_999 }, 1)).toBe(3_600_000);
  });

  it('is accepted by --allow-tools and included with every category', () => {
    expect(parseToolList('read,git-write')).toEqual(['read', 'git-write']);
    expect(AGENT_ALL_TOOL_CATEGORIES).toContain('git-write');
  });
});

describe('permission modes', () => {
  it('asks for every git-write operation in ask and accept-edits, never for reads', () => {
    for (const mode of ['ask', 'accept-edits'] as const) {
      for (const operation of WRITES) expect(needsApproval(mode, request(operation))).toBe(true);
      for (const operation of READS) expect(needsApproval(mode, request(operation))).toBe(false);
    }
  });

  it('denies a git-write with nobody to ask, and honours the answer when there is one', async () => {
    const repo = makeRepository();
    const all = { allow: AGENT_ALL_TOOL_CATEGORIES };
    const silent = workspaceToolkit(repo, permissionsForMode('ask', all));
    const asked: string[] = [];
    const answering = (answer: boolean) =>
      workspaceToolkit(
        repo,
        permissionsForMode('accept-edits', {
          ...all,
          approve: (item) => {
            asked.push(`${item.category}:${item.operation}`);
            return answer;
          },
        }),
      );

    expect(await silent.authorize?.(call('commit', { message: 'x' }))).toBe(false);
    expect(await silent.authorize?.(call('status'))).toBe(true);
    expect(await answering(false).authorize?.(call('push'))).toBe(false);
    expect(await answering(true).authorize?.(call('push'))).toBe(true);
    expect(await answering(true).authorize?.(call('log'))).toBe(true);
    expect(asked).toEqual(['git-write:push', 'git-write:push']);
  });

  it('plan mode withdraws git-write and denies it', async () => {
    const repo = makeRepository();
    const planned = permissionsForMode('plan', { allow: AGENT_ALL_TOOL_CATEGORIES });
    const toolkit = workspaceToolkit(repo, planned);

    expect(planned.allow).not.toContain('git-write');
    expect(await toolkit.authorize?.(call('commit', { message: 'x' }))).toBe(false);
    expect(await toolkit.authorize?.(call('show'))).toBe(true);
  });

  it('a run granted only git cannot commit through the toolkit', async () => {
    const repo = makeRepository();
    writeIn(repo, 'a.txt', 'a');
    const toolkit = workspaceToolkit(repo, { allow: ['read', 'git'] });

    expect(await toolkit.authorize?.(call('add', { paths: ['a.txt'] }))).toBe(false);
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('');
  });
});

describe('write hardening', () => {
  it('keeps hooks enabled and every program-naming key pinned', () => {
    const args = hardenedGitWriteArguments(['commit', '-F', 'message.txt']);
    const pairs = args.filter((_, index) => args[index - 1] === '-c');

    expect(pairs).toEqual([
      'core.fsmonitor=false',
      'core.pager=cat',
      'core.editor=true',
      'diff.external=',
      'protocol.ext.allow=never',
      'core.sshCommand=ssh',
    ]);
    expect(pairs.some((pair) => pair.startsWith('core.hooksPath'))).toBe(false);
    expect(args.slice(-3)).toEqual(['commit', '-F', 'message.txt']);
  });

  it('is refused unless the workspace is trusted', () => {
    expect(() => prepareTrustedGitWriteSpawn(['commit'], {}, false)).toThrow(/trusted/u);
    expect(prepareTrustedGitWriteSpawn(['commit'], { PATH: 'p' }, true).environment).toMatchObject({
      GIT_TERMINAL_PROMPT: '0',
      PATH: 'p',
    });
  });
});
