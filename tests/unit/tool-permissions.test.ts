import { describe, expect, it } from 'vitest';

import { permissionsForMode } from '../../src/sdk/permission-modes';
import { toolIdentifiers, toolPermitted } from '../../src/sdk/tool-filter';
import { combineToolkits, restrictToolkit } from '../../src/sdk/toolkit-compose';
import { workspaceToolkit } from '../../src/sdk/workspace-toolkit';

import type { AgentToolCall } from '../../src/sdk/agent-sdk.types';
import type {
  AgentApprovalRequest,
  AgentToolCategory,
} from '../../src/sdk/workspace-toolkit.types';

const file = (operation: string): AgentToolCall => ({
  toolName: 'workspace.file',
  operation,
  arguments: {},
});
const mcp = (operation: string, args: Record<string, unknown> = {}): AgentToolCall => ({
  toolName: 'runtime.mcp',
  operation,
  arguments: args,
});
const request = (call: AgentToolCall, category: AgentToolCategory): AgentApprovalRequest => ({
  ...call,
  category,
});

describe('toolPermitted', () => {
  it('names calls by tool and operation, and MCP calls by server and tool', () => {
    expect(toolIdentifiers(file('read'))).toEqual(['workspace.file.read']);
    expect(toolIdentifiers(mcp('call', { server: 'echo', tool: 'say' }))).toEqual([
      'mcp__echo__say',
    ]);
  });

  it('restricts nothing with empty lists', () => {
    expect(toolPermitted({}, file('create'))).toBe(true);
  });

  it('admits only what the allow list matches', () => {
    const filter = { allow: ['workspace.file.read', 'workspace.git.*'] };

    expect(toolPermitted(filter, file('read'))).toBe(true);
    expect(toolPermitted(filter, { ...file('status'), toolName: 'workspace.git' })).toBe(true);
    expect(toolPermitted(filter, file('create'))).toBe(false);
  });

  it('lets deny win over allow', () => {
    const filter = { allow: ['workspace.file.*'], deny: ['workspace.file.create'] };

    expect(toolPermitted(filter, file('read'))).toBe(true);
    expect(toolPermitted(filter, file('create'))).toBe(false);
  });

  it('matches MCP tools by glob and lets discovery through when an MCP tool is allowed', () => {
    const filter = { allow: ['mcp__echo__*'], deny: ['mcp__echo__fail'] };

    expect(toolPermitted(filter, mcp('call', { server: 'echo', tool: 'echo' }))).toBe(true);
    expect(toolPermitted(filter, mcp('call', { server: 'echo', tool: 'fail' }))).toBe(false);
    expect(toolPermitted(filter, mcp('call', { server: 'other', tool: 'echo' }))).toBe(false);
    expect(toolPermitted(filter, mcp('servers'))).toBe(true);
    expect(toolPermitted(filter, mcp('tools', { server: 'echo' }))).toBe(true);
  });

  it('denies a whole server from its listing too', () => {
    const filter = { deny: ['mcp__echo__*'] };

    expect(toolPermitted(filter, mcp('tools', { server: 'echo' }))).toBe(false);
    expect(toolPermitted(filter, mcp('tools', { server: 'other' }))).toBe(true);
  });
});

describe('permissionsForMode', () => {
  const base = (approve?: (entry: AgentApprovalRequest) => boolean) => ({
    allow: ['read', 'write', 'command', 'git', 'mcp'] as const,
    approve,
  });

  it('plan keeps only read and git and asks nothing', () => {
    const permissions = permissionsForMode(
      'plan',
      base(() => true),
    );

    expect(permissions.allow).toEqual(['read', 'git']);
    expect(permissions.approve).toBeUndefined();
  });

  it('ask sends writes, commands and MCP calls to the callback, and nothing else', async () => {
    const asked: string[] = [];
    const { approve } = permissionsForMode(
      'ask',
      base((entry) => {
        asked.push(entry.category);
        return false;
      }),
    );

    expect(await approve?.(request(file('read'), 'read'))).toBe(true);
    expect(await approve?.(request(mcp('servers'), 'mcp'))).toBe(true);
    expect(await approve?.(request(file('create'), 'write'))).toBe(false);
    expect(await approve?.(request(mcp('call'), 'mcp'))).toBe(false);
    expect(asked).toEqual(['write', 'mcp']);
  });

  it('accept-edits accepts writes but still asks for commands', async () => {
    const asked: string[] = [];
    const { approve } = permissionsForMode(
      'accept-edits',
      base((entry) => {
        asked.push(entry.category);
        return true;
      }),
    );

    expect(await approve?.(request(file('create'), 'write'))).toBe(true);
    expect(asked).toEqual([]);
    await approve?.(request({ ...file('run'), toolName: 'workspace.command' }, 'command'));
    expect(asked).toEqual(['command']);
  });

  it('denies what needs approval when there is no callback to ask', async () => {
    const { approve } = permissionsForMode('accept-edits', base());

    expect(await approve?.(request(file('create'), 'write'))).toBe(true);
    expect(await approve?.(request(mcp('call'), 'mcp'))).toBe(false);
  });
});

describe('restrictToolkit and combineToolkits', () => {
  const inner = workspaceToolkit('/tmp/none', { allow: ['read', 'write'] });

  it('drops denied operations from what the model is offered', () => {
    const restricted = restrictToolkit(inner, { deny: ['workspace.file.create'] });
    const definition = restricted.definitions[0] as { operations: string[] };

    expect(definition.operations).toEqual(['read', 'list']);
  });

  it('checks the filter before the inner authorization, so a denied call is never asked', async () => {
    let asked = 0;
    const toolkit = restrictToolkit(
      {
        ...inner,
        authorize: () => {
          asked += 1;
          return true;
        },
      },
      { deny: ['workspace.file.*'] },
    );

    expect(await toolkit.authorize?.(file('read'))).toBe(false);
    expect(asked).toBe(0);
  });

  it('routes a call to the toolkit that offers the tool and denies a stranger', async () => {
    const combined = combineToolkits([inner]);

    expect(await combined.authorize?.(file('read'))).toBe(true);
    expect(await combined.authorize?.(mcp('servers'))).toBe(false);
    expect(() => combined.execute(mcp('servers'))).toThrow(/No tool named/u);
  });
});
