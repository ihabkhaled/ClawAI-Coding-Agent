import { afterEach, describe, expect, it } from 'vitest';

import {
  KnowledgeToolExecutor,
  knowledgeToolDefinition,
} from '../../src/infrastructure/knowledge-tool-executor';

import { cleanFixtures, fixture, ROOT_CLAUDE } from './knowledge-fixture';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

afterEach(cleanFixtures);

function invocation(
  operation: string,
  args: Record<string, string>,
  toolName = 'knowledge.context',
) {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    toolName,
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-11-01T10:00:00.000Z',
  } as ToolInvocation;
}

describe('knowledge.context in the panel', () => {
  it('is a read-only inspect tool with all four operations', () => {
    expect(knowledgeToolDefinition.name).toBe('knowledge.context');
    expect(knowledgeToolDefinition.riskClasses).toEqual(['inspect']);
    expect([...knowledgeToolDefinition.operations].sort()).toEqual([
      'index',
      'read',
      'search',
      'task',
    ]);
  });

  it('reads and searches the workspace rules, marked untrusted', async () => {
    const root = fixture({ 'CLAUDE.md': ROOT_CLAUDE });
    const executor = new KnowledgeToolExecutor(() => root);
    const read = await executor.execute(invocation('read', { path: 'CLAUDE.md' }));
    expect(read.modelText).toContain('NEVER bypass a git hook.');
    expect(read.modelText).toContain('Repository reference text');
    const found = await executor.execute(invocation('search', { query: 'git hook' }));
    expect(found.modelText).toContain('CLAUDE.md');
  });

  it('follows the folder the run is in', async () => {
    const first = fixture({ 'CLAUDE.md': '# First\n\n## Never\n\n- NEVER one thing.\n' });
    const second = fixture({ 'CLAUDE.md': '# Second\n\n## Never\n\n- NEVER another thing.\n' });
    let root = first;
    const executor = new KnowledgeToolExecutor(() => root);
    expect((await executor.execute(invocation('read', { path: 'CLAUDE.md' }))).modelText).toContain(
      'NEVER one thing',
    );
    root = second;
    expect((await executor.execute(invocation('read', { path: 'CLAUDE.md' }))).modelText).toContain(
      'NEVER another thing',
    );
  });

  it('refuses a path outside the workspace', async () => {
    const root = fixture({ 'CLAUDE.md': ROOT_CLAUDE });
    const executor = new KnowledgeToolExecutor(() => root);
    await expect(
      executor.execute(invocation('read', { path: '../../etc/passwd' })),
    ).rejects.toThrow();
  });

  it('refuses another tool, an unknown operation and a missing folder', async () => {
    const root = fixture({ 'CLAUDE.md': ROOT_CLAUDE });
    const executor = new KnowledgeToolExecutor(() => root);
    await expect(executor.execute(invocation('read', {}, 'workspace.files'))).rejects.toThrow(
      'Unknown knowledge tool',
    );
    await expect(executor.execute(invocation('write', {}))).rejects.toThrow('no operation');
    await expect(
      new KnowledgeToolExecutor(() => undefined).execute(invocation('index', {})),
    ).rejects.toThrow('Open a workspace folder');
  });
});
