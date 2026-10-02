import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HEADLESS_BARE_FLAGS,
  HEADLESS_TOOL_CATEGORIES,
  HEADLESS_USAGE,
  HEADLESS_VALUE_FLAGS,
} from '../../src/headless/headless-args.constants';
import { createTeam } from '../../src/sdk/agent-team';
import { agentToolkit } from '../../src/sdk/agent-toolkit';
import { createAgent } from '../../src/sdk/create-agent';

import type { AgentConfig } from '../../src/sdk/create-agent.types';
import type { AgentToolCategory } from '../../src/sdk/workspace-toolkit.types';

const BASE = { auth: { token: 'x' }, workspaceRoot: os.tmpdir() } as const;

const EVERY: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'mcp',
  'http',
  'http-write',
  'browser',
  'shell',
  'agents',
];

/** Every category on, and every option a tool needs to exist. */
function everything(extra: Partial<AgentConfig> = {}): AgentConfig {
  return {
    ...BASE,
    permissions: { allow: EVERY, httpAllowHosts: ['localhost'], shell: {} },
    loadKnowledge: true,
    taskPlan: true,
    vision: {},
    browser: {},
    ...extra,
  };
}

interface Listed {
  readonly names: readonly string[];
  readonly operations: Readonly<Record<string, number>>;
  readonly characters: number;
}

function listed(config: AgentConfig): Listed {
  const team = createTeam(config, createAgent);
  const toolkit = agentToolkit(config, undefined, () => undefined, team);
  const definitions = toolkit.definitions as readonly { name: string; operations: string[] }[];
  toolkit.dispose?.();
  return {
    names: definitions.map((definition) => definition.name),
    operations: Object.fromEntries(
      definitions.map((definition) => [definition.name, definition.operations.length]),
    ),
    characters: JSON.stringify(definitions).length,
  };
}

describe('the tools added in 1.96.0, all together', () => {
  it('offers each tool once, with at least one operation', () => {
    const all = listed(everything());

    expect(new Set(all.names).size).toBe(all.names.length);
    expect([...all.names].sort()).toEqual(
      [
        'agent.team',
        'browser.page',
        'code.gates',
        'http.request',
        'knowledge.context',
        'process.watch',
        'task.plan',
        'vision.describe',
        'workspace.command',
        'workspace.file',
        'workspace.git',
        'workspace.notes',
        'workspace.shell',
      ].sort(),
    );
    expect(Object.values(all.operations).every((count) => count > 0)).toBe(true);
  });

  it('keeps the whole definition set inside a budget the owner can see', () => {
    const all = listed(everything());

    // Measured at integration: 21,394 characters for every category on.
    expect(all.characters).toBeLessThan(23_500);
  });

  it('adds no tool to the default grants, and a permission mode adds none', () => {
    const plain = listed(BASE);
    const moded = listed({ ...BASE, permissionMode: 'ask' });

    expect([...plain.names].sort()).toEqual(
      ['workspace.file', 'workspace.git', 'workspace.notes'].sort(),
    );
    expect(moded.names).toEqual(plain.names);
    // Measured at integration: 5,274 characters, the same as before 1.96.0.
    expect(plain.characters).toBeLessThan(5_400);
  });

  it('adds only the two command-class tools when the command grant is given', () => {
    const withCommand = listed({ ...BASE, permissions: { allow: ['read', 'git', 'command'] } });

    expect([...withCommand.names].sort()).toEqual(
      [
        'code.gates',
        'process.watch',
        'workspace.command',
        'workspace.file',
        'workspace.git',
        'workspace.notes',
      ].sort(),
    );
  });

  it('offers task.plan only when a plan was asked for, in any of the three ways', () => {
    const asked: readonly Partial<AgentConfig>[] = [
      { taskPlan: true },
      { requirePlan: true },
      { planSteps: [{ title: 'one' }] },
    ];

    expect(listed(BASE).names).not.toContain('task.plan');
    for (const extra of asked) expect(listed({ ...BASE, ...extra }).names).toContain('task.plan');
  });

  it('keeps a tool off when its second switch is missing', () => {
    const noSwitches = listed({
      ...BASE,
      permissions: { allow: EVERY.filter((category) => category !== 'agents') },
    });

    expect(noSwitches.names).not.toContain('workspace.shell');
    expect(noSwitches.names).not.toContain('http.request');
    expect(noSwitches.names).not.toContain('knowledge.context');
    expect(noSwitches.names).not.toContain('vision.describe');
    expect(noSwitches.names).not.toContain('agent.team');
  });

  it('refuses every state-changing call in plan mode, whatever else is granted', async () => {
    const toolkit = agentToolkit(everything({ permissionMode: 'plan' }));
    const calls: readonly [string, string, Record<string, unknown>][] = [
      ['workspace.command', 'run', { executable: 'node', arguments: [] }],
      ['code.gates', 'run', { gate: 'test' }],
      ['process.watch', 'start', { executable: 'node', arguments: [] }],
      ['browser.page', 'open', { url: 'https://example.com' }],
      ['workspace.shell', 'run', { script: 'echo hi' }],
      ['http.request', 'request', { method: 'POST', url: 'http://localhost/x' }],
      ['agent.team', 'spawn', { name: 'a', task: 'x' }],
      ['workspace.file', 'write', { path: 'a.txt', content: 'x' }],
    ];
    const answers = await Promise.all(
      calls.map(async ([toolName, operation, args]) =>
        toolkit.authorize?.({ toolName, operation, arguments: args }),
      ),
    );
    toolkit.dispose?.();

    expect(answers).toEqual(calls.map(() => false));
  });
});

describe('--allow-tools documents every category', () => {
  const docs = readFileSync(path.join(__dirname, '../../docs/HEADLESS.md'), 'utf8');
  const row = docs.split('\n').find((line) => line.startsWith('| `--allow-tools'));
  const usage = HEADLESS_USAGE;

  it('lists each category in the usage text and the flag table', () => {
    expect(row).toBeDefined();
    for (const category of HEADLESS_TOOL_CATEGORIES) {
      expect(usage).toContain(category);
      expect(row).toMatch(new RegExp(`(?<![a-z-])${category}(?![a-z-])`, 'u'));
    }
  });

  it('names the command-class tools that ride on the command grant', () => {
    expect(row).toContain('code.gates');
    expect(row).toContain('process.watch');
  });
});

describe('the flags added in 1.96.0 do not collide', () => {
  it('has no bare flag twice, and none that also takes a value', () => {
    expect(new Set(HEADLESS_BARE_FLAGS).size).toBe(HEADLESS_BARE_FLAGS.length);
    for (const flag of HEADLESS_BARE_FLAGS) expect(HEADLESS_VALUE_FLAGS[flag]).toBeUndefined();
  });

  it('fills each invocation field from one flag only, apart from the short spellings', () => {
    const owners = new Map<string, string[]>();
    for (const [flag, field] of Object.entries(HEADLESS_VALUE_FLAGS)) {
      owners.set(field, [...(owners.get(field) ?? []), flag]);
    }
    const shared = [...owners.entries()].filter(([, flags]) => flags.length > 1);

    expect(shared).toEqual([['prompt', ['-p', '--prompt']]]);
  });

  it('prints every flag in the usage text', () => {
    const flags = [...HEADLESS_BARE_FLAGS, ...Object.keys(HEADLESS_VALUE_FLAGS)].filter((flag) =>
      flag.startsWith('--'),
    );
    const missing = flags.filter((flag) => !HEADLESS_USAGE.includes(flag));

    expect(missing).toEqual([]);
  });
});
