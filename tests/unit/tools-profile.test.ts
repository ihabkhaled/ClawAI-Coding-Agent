import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { agentToolkit } from '../../src/sdk/agent-toolkit';
import { createAgent } from '../../src/sdk/create-agent';
import { definitionsFor } from '../../src/sdk/tool-catalog-scenarios';
import { resolveToolsProfile, toolsProfileProblem } from '../../src/sdk/tools-profile';
import {
  DEV_PROFILE_PATTERNS,
  MINIMAL_PROFILE_PATTERNS,
} from '../../src/sdk/tools-profile.constants';

import type { AgentConfig } from '../../src/sdk/create-agent.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

function config(allow: readonly AgentToolCategory[], toolsProfile?: string): AgentConfig {
  return {
    auth: { token: 't' },
    workspaceRoot: process.cwd(),
    permissions: { allow },
    ...(toolsProfile === undefined ? {} : { toolsProfile }),
  };
}

function offered(definitions: readonly unknown[]): string[] {
  return definitions.flatMap((entry) => {
    const { name, operations } = entry as { name: string; operations: string[] };
    return operations.map((operation) => `${name}.${operation}`);
  });
}

describe('tools profiles', () => {
  it('expands minimal and dev, and lets full lift the limit', () => {
    expect(resolveToolsProfile('minimal').allow).toEqual(MINIMAL_PROFILE_PATTERNS);
    expect(resolveToolsProfile('dev').allow).toEqual(DEV_PROFILE_PATTERNS);
    expect(resolveToolsProfile('dev').taskPlan).toBe(true);
    expect(resolveToolsProfile('minimal').taskPlan).toBe(false);
    expect(resolveToolsProfile('full').allow).toBeUndefined();
  });

  it('adds a custom list to a named profile', () => {
    const { allow } = resolveToolsProfile('minimal,browser.page');

    expect(allow).toContain('browser.page');
    expect(allow).toContain('workspace.file.read');
  });

  it('refuses an unknown word, an empty spec and an over-long pattern', () => {
    expect(toolsProfileProblem('everything')).toContain('Unknown tools profile "everything"');
    expect(toolsProfileProblem(' , ')).toContain('needs a name or patterns');
    expect(toolsProfileProblem(`a.${'x'.repeat(300)}`)).toContain('1 to');
    expect(toolsProfileProblem('dev,workspace.file.*')).toBeUndefined();
  });

  it('offers the profile subset of what is granted', () => {
    const all: AgentToolCategory[] = ['read', 'write', 'command', 'git', 'git-write'];
    const minimal = offered(agentToolkit(config(all, 'minimal')).definitions);

    expect(minimal).toContain('workspace.file.read');
    expect(minimal).toContain('workspace.command.run');
    expect(minimal).toContain('workspace.git.status');
    expect(minimal).not.toContain('workspace.file.create');
    expect(minimal).not.toContain('workspace.git.commit');
    expect(minimal).not.toContain('code.gates.run');

    const dev = offered(agentToolkit(config(all, 'dev')).definitions);
    expect(dev).toContain('workspace.file.update');
    expect(dev).toContain('workspace.git.commit');
    expect(dev).toContain('code.gates.run');
    expect(dev).toContain('task.plan.set');
    expect(dev).toContain('process.watch.start');
  });

  it('never grants more than the allowed categories', async () => {
    const toolkit = agentToolkit(config(['read', 'git'], 'dev'));
    const names = offered(toolkit.definitions);

    expect(names).not.toContain('workspace.file.create');
    expect(names).not.toContain('workspace.command.run');
    expect(names).not.toContain('code.gates.run');
    expect(
      await toolkit.authorize?.({
        toolName: 'workspace.file',
        operation: 'create',
        arguments: { path: 'a', content: 'b' },
      }),
    ).toBe(false);
    expect(
      await toolkit.authorize?.({ toolName: 'workspace.file', operation: 'read', arguments: {} }),
    ).toBe(true);
    toolkit.dispose?.();
  });

  it('refuses a call the profile left out even when the category allows it', async () => {
    const toolkit = agentToolkit(config(['read', 'write'], 'minimal'));

    expect(
      await toolkit.authorize?.({
        toolName: 'workspace.file',
        operation: 'delete',
        arguments: { path: 'a' },
      }),
    ).toBe(false);
  });

  it('cuts the catalog the model pays for', () => {
    const all: AgentToolCategory[] = ['read', 'write', 'command', 'git', 'git-write', 'agents'];
    const size = (profile?: string): number =>
      JSON.stringify(definitionsFor(all, false, profile)).length;

    expect(size('minimal')).toBeLessThan(size() * 0.8);
    expect(size('minimal')).toBeLessThan(size('dev'));
    expect(size('dev')).toBeLessThanOrEqual(size('full'));
  });

  it('is checked before a run starts', () => {
    expect(() => createAgent(config(['read'], 'nonsense'))).toThrow(/Unknown tools profile/u);
    expect(() => createAgent(config(['read'], 'workspace.nothing'))).toThrow(/No tool is left/u);
  });

  it('is parsed from --tools-profile and --defer-tools', () => {
    const parsed = parseHeadlessArgs(
      ['-p', 'x', '--tools-profile', 'dev', '--defer-tools'],
      {},
      process.cwd(),
    );
    expect(parsed.kind).toBe('run');
    if (parsed.kind === 'run') {
      expect(parsed.invocation.toolsProfile).toBe('dev');
      expect(parsed.invocation.deferTools).toBe(true);
    }
    const bad = parseHeadlessArgs(['-p', 'x', '--tools-profile', 'huge'], {}, process.cwd());
    expect(bad).toMatchObject({ kind: 'usage' });
    const none = parseHeadlessArgs(['-p', 'x'], {}, process.cwd());
    expect(none.kind === 'run' && none.invocation.toolsProfile).toBeFalsy();
  });
});
