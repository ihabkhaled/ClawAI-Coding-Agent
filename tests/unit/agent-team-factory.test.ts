import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTeam } from '../../src/sdk/agent-team';
import { cleanTeamFixtures, scratch } from '../helpers/team-fixture';

import type { AgentToolkit } from '../../src/sdk/agent-sdk.types';
import type { AgentTeam } from '../../src/sdk/agent-team-tool.types';
import type {
  Agent,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentRunCallOptions,
} from '../../src/sdk/create-agent.types';
import type { AgentPermissions } from '../../src/sdk/workspace-toolkit.types';

const NAME = 'agent.team';

beforeEach(() => {
  vi.stubEnv('CLAW_STATE_DIR', scratch('claw-team-state-'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanTeamFixtures();
});

const DONE: AgentResult = {
  outcome: 'completed',
  exitCode: 0,
  toolCalls: 3,
  deniedCalls: 0,
  text: 'finished',
};

interface Harness {
  readonly team: AgentTeam;
  readonly tools: AgentToolkit;
  readonly configs: AgentConfig[];
  readonly events: AgentEvent[];
  readonly abort: AbortController;
  call(operation: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

type RunBehaviour = (
  config: AgentConfig,
  prompt: string,
  options: AgentRunCallOptions,
) => Promise<AgentResult>;

function harness(
  behaviour: RunBehaviour,
  config: Partial<AgentConfig> = {},
  grants: AgentPermissions = { allow: ['read', 'write', 'command', 'agents'] },
): Harness {
  const configs: AgentConfig[] = [];
  const events: AgentEvent[] = [];
  const abort = new AbortController();
  const full: AgentConfig = {
    auth: { token: 'parent-token' },
    workspaceRoot: scratch('claw-team-ws-'),
    permissions: grants,
    ...config,
  };
  const factory = (made: AgentConfig): Agent => {
    configs.push(made);
    return {
      run: (prompt, options = {}) => behaviour(made, prompt, options),
    };
  };
  const team = createTeam(full, factory);
  if (team === undefined) throw new Error('no team');
  team.attach({
    signal: abort.signal,
    emit: (event) => events.push(event),
    callsSoFar: () => 0,
    maxToolCalls: 400,
    deadlineAt: undefined,
    token: () => 'live-token',
  });
  const tools = team.toolkit(grants.allow, grants.approve);
  if (tools === undefined) throw new Error('no tool');
  return {
    team,
    tools,
    configs,
    events,
    abort,
    call: async (operation, args = {}) =>
      (await tools.execute({ toolName: NAME, operation, arguments: args })) as Record<
        string,
        unknown
      >,
  };
}

const sleepsUntilAborted: RunBehaviour = (_config, _prompt, options) =>
  new Promise((resolve) => {
    options.signal?.addEventListener('abort', () => {
      resolve({ ...DONE, outcome: 'cancelled', exitCode: 130, text: '' });
    });
  });

describe('the child a spawn builds', () => {
  it('is the parent configuration, narrowed, and cannot raise the mode or loosen the filters', async () => {
    const approve = vi.fn(() => true);
    const made = harness(
      async () => DONE,
      {
        permissionMode: 'ask',
        systemPrompt: 'OPERATOR RULES',
        allowedTools: ['workspace.file.*', 'agent.team.*'],
        disallowedTools: ['workspace.command.*'],
        model: 'parent-model',
        provider: 'OLLAMA',
        backendUrl: 'https://example.invalid/api',
      },
      {
        allow: ['read', 'write', 'agents'],
        approve,
        writeDeny: ['secret/**'],
        allowedExecutables: ['make'],
      },
    );
    await made.call('spawn', { name: 'kid', task: 'do it', tools: ['read', 'write'] });
    await made.call('wait', { timeoutMs: 5_000 });
    const child = made.configs[0];
    if (child === undefined) throw new Error('no child');
    expect(child.auth).toEqual({ token: 'live-token' });
    expect(child.permissionMode).toBe('ask');
    expect(child.permissions?.allow).toEqual(['read', 'write']);
    expect(child.permissions?.approve).toBe(approve);
    expect(child.permissions?.writeDeny).toEqual(['secret/**']);
    expect(child.permissions?.allowedExecutables).toEqual(['make']);
    expect(child.systemPrompt).toBe('OPERATOR RULES');
    expect(child.allowedTools).toEqual(['workspace.file.*', 'agent.team.*']);
    expect(child.disallowedTools).toEqual(['workspace.command.*']);
    expect(child.model).toBe('parent-model');
    expect(child.provider).toBe('OLLAMA');
    expect(child.backendUrl).toBe('https://example.invalid/api');
    expect(child.teamLink).toMatchObject({ name: 'kid', depth: 1 });
    expect(child.mcp).toBeUndefined();
  });

  it('may use another model when asked, and only a plausible model id', async () => {
    const made = harness(async () => DONE);
    await made.call('spawn', { name: 'kid', task: 't', tools: ['read'], model: 'glm-5.2' });
    await expect(
      made.call('spawn', { name: 'bad', task: 't', model: 'x; rm -rf /' }),
    ).rejects.toThrow('not a model id');
    await made.call('wait', { timeoutMs: 5_000 });
    expect(made.configs[0]?.model).toBe('glm-5.2');
  });

  it('carries the parent credential as given when the parent has no live token', async () => {
    const made = harness(async () => DONE);
    // The harness token reader answers, so the child gets the live token; with a parent token it is the same.
    await made.call('spawn', { name: 'kid', task: 't', tools: ['read'] });
    await made.call('wait', {});
    expect(made.configs[0]?.auth).toEqual({ token: 'live-token' });
  });

  it('passes the deny list down so the child is denied what the parent is denied', async () => {
    const made = harness(
      async () => DONE,
      {},
      { allow: ['read', 'write', 'agents'], writeScope: ['app/**'], writeDeny: ['app/secret/**'] },
    );
    await made.call('spawn', {
      name: 'kid',
      task: 't',
      tools: ['write'],
      writeScope: ['app/a/**'],
      workspaceSubdir: undefined,
    });
    await made.call('wait', {});
    expect(made.configs[0]?.permissions?.writeScope).toEqual(['app/a/**']);
    expect(made.configs[0]?.permissions?.writeDeny).toEqual(['app/secret/**']);
  });
});

describe('a child that goes wrong', () => {
  it('that throws from run reports failed with a redacted reason', async () => {
    const made = harness(async () => {
      throw new Error('connect failed with Bearer abcdefghijklmnop1234567890');
    });
    await made.call('spawn', { name: 'bad', task: 't', tools: ['read'] });
    const waited = await made.call('wait', { timeoutMs: 5_000 });
    const child = (waited.children as { state: string; error: string }[])[0];
    expect(waited.done).toBe(true);
    expect(child?.state).toBe('failed');
    expect(child?.error).toContain('connect failed');
    expect(child?.error).not.toContain('abcdefghijklmnop1234567890');
    expect(made.events.at(-1)).toMatchObject({
      type: 'agent.finished',
      name: 'bad',
      state: 'failed',
    });
  });

  it('whose factory throws fails at once and frees its slot for the next', async () => {
    let first = true;
    const refusing = harness(
      async () => {
        if (first) {
          first = false;
          throw new RangeError('unusable configuration');
        }
        return DONE;
      },
      { maxAgents: 1 },
    );
    await refusing.call('spawn', { name: 'a', task: 't', tools: ['read'] });
    await refusing.call('spawn', { name: 'b', task: 't', tools: ['read'] });
    const waited = await refusing.call('wait', { timeoutMs: 5_000 });
    expect((waited.children as { state: string }[]).map((child) => child.state)).toEqual([
      'failed',
      'completed',
    ]);
  });

  it('that ignores cancel is given up on after its time and a grace, so a wait always ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const made = harness(() => new Promise<AgentResult>(() => undefined));
    await made.call('spawn', {
      name: 'stuck',
      task: 't',
      tools: ['read'],
      budget: { maxDurationSec: 10 },
    });
    const waiting = made.call('wait', { timeoutMs: 240_000 });
    await vi.advanceTimersByTimeAsync(31_000);
    const waited = await waiting;
    expect(waited.done).toBe(true);
    const child = (waited.children as { state: string; error: string }[])[0];
    expect(child?.state).toBe('failed');
    expect(child?.error).toContain('did not stop');
  });

  it('is not counted as finished twice when it ends after it was given up on', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let release: (value: AgentResult) => void = () => undefined;
    const made = harness(
      () =>
        new Promise<AgentResult>((resolve) => {
          release = resolve;
        }),
    );
    await made.call('spawn', {
      name: 'late',
      task: 't',
      tools: ['read'],
      budget: { maxDurationSec: 10 },
    });
    const waiting = made.call('wait', { timeoutMs: 240_000 });
    await vi.advanceTimersByTimeAsync(31_000);
    await waiting;
    release(DONE);
    await vi.advanceTimersByTimeAsync(10);
    expect(made.events.filter((event) => event.type === 'agent.finished')).toHaveLength(1);
  });
});

describe('concurrent calls', () => {
  it('start one child when two spawns race for the same name', async () => {
    const made = harness(sleepsUntilAborted);
    const results = await Promise.allSettled([
      made.call('spawn', { name: 'race', task: 't', tools: ['read'] }),
      made.call('spawn', { name: 'race', task: 't', tools: ['read'] }),
    ]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(made.configs).toHaveLength(1);
    await made.team.close();
  });

  it('refuse a ninth child even when nine spawns arrive together', async () => {
    const made = harness(sleepsUntilAborted, { maxAgents: 8 });
    const results = await Promise.allSettled(
      Array.from({ length: 9 }, (_, index) =>
        made.call('spawn', {
          name: `c${String(index)}`,
          task: 't',
          tools: ['read'],
          budget: { maxToolCalls: 9 },
        }),
      ),
    );
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(8);
    await made.team.close();
  });

  it('let many waits on the same children all return', async () => {
    const made = harness(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return DONE;
    });
    await made.call('spawn', { name: 'one', task: 't', tools: ['read'] });
    const waits = await Promise.all([
      made.call('wait', {}),
      made.call('wait', {}),
      made.call('wait', {}),
    ]);
    expect(waits.map((entry) => entry.done)).toEqual([true, true, true]);
  });
});

describe('close', () => {
  it('cancels what is running, waits for it, and a second close does nothing', async () => {
    const made = harness(sleepsUntilAborted);
    await made.call('spawn', { name: 'a', task: 't', tools: ['read'] });
    await made.call('spawn', { name: 'b', task: 't', tools: ['read'] });
    await made.team.close();
    await made.team.close();
    expect(
      made.events.filter((event) => event.type === 'agent.finished').map((event) => event.state),
    ).toEqual(['cancelled', 'cancelled']);
  });
});
