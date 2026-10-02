import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanTeamFixtures,
  makeDir,
  must,
  readIn,
  runTeam,
  scratch,
} from '../helpers/team-fixture';
import { nap } from '../helpers/team-transport';

import type { ScriptApi } from '../helpers/team-transport';

afterEach(cleanTeamFixtures);

const AGENT = 'agent.team';

/** A child that writes one file in its own folder and reports. */
const writer = (file: string, report: string) => async (api: ScriptApi) => {
  must(
    await api.call('workspace.file', 'create', { path: file, content: `export const x = 1;\n` }),
  );
  api.say(report);
};

describe('agent.team: the happy path', () => {
  it('starts children, waits for them, and returns their reports and files', async () => {
    const run = await runTeam({
      lead: async (api) => {
        for (const name of ['mod-a', 'mod-b']) {
          const spawned = must(
            await api.call(AGENT, 'spawn', {
              name,
              task: `Build ${name}`,
              tools: ['read', 'write'],
              writeScope: [`${name}/**`],
            }),
          );
          expect(spawned.name).toBe(name);
        }
        const waited = must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
        expect(waited.done).toBe(true);
        const children = waited.children as { name: string; state: string; report?: string }[];
        expect(children.map((child) => child.state)).toEqual(['completed', 'completed']);
        expect(children[0]?.report).toBe('mod-a is built');
        const full = must(await api.call(AGENT, 'result', { name: 'mod-b' }));
        expect(full.files).toEqual(['mod-b/index.ts']);
        api.say('combined ok');
      },
      children: {
        'mod-a': writer('mod-a/index.ts', 'mod-a is built'),
        'mod-b': writer('mod-b/index.ts', 'mod-b is built'),
      },
    });
    expect(run.result).toMatchObject({ outcome: 'completed', text: 'combined ok' });
    expect(readIn(run.workspace, 'mod-a/index.ts')).toContain('export const x');
    expect(readIn(run.workspace, 'mod-b/index.ts')).toContain('export const x');
    const kinds = run.events
      .filter((event) => event.type.startsWith('agent.'))
      .map((e) => `${e.type}:${'name' in e ? e.name : ''}`);
    expect(kinds.slice(0, 2)).toEqual(['agent.spawned:mod-a', 'agent.spawned:mod-b']);
    expect(kinds).toContain('agent.finished:mod-a');
    expect(kinds).toContain('agent.finished:mod-b');
  });

  it('tells each child who it is, what it may change, and that its brief is all it has', async () => {
    const prompts: string[] = [];
    await runTeam({
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', {
            name: 'solo',
            task: 'THE-TASK-TEXT',
            tools: ['read', 'write'],
            writeScope: ['x/**'],
          }),
        );
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        solo: async (api) => {
          prompts.push(api.prompt);
        },
      },
    });
    expect(prompts[0]).toContain('sub-agent "solo"');
    expect(prompts[0]).toContain('You may change only: x/**.');
    expect(prompts[0]).toContain('THE-TASK-TEXT');
  });
});

describe('agent.team: a child can only narrow what its parent holds', () => {
  it('leaves out categories the parent does not hold and says so', async () => {
    let spawned: Record<string, unknown> = {};
    await runTeam({
      config: { permissions: { allow: ['read', 'write', 'agents'] } },
      lead: async (api) => {
        spawned = must(
          await api.call(AGENT, 'spawn', { name: 'c1', task: 't', tools: ['read', 'command'] }),
        );
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
    });
    expect(spawned.granted).toEqual(['read']);
    expect(spawned.notGranted).toEqual(['command']);
  });

  it('refuses a child that would hold nothing', async () => {
    let message = '';
    await runTeam({
      config: { permissions: { allow: ['read', 'agents'] } },
      lead: async (api) => {
        const out = await api.call(AGENT, 'spawn', { name: 'c1', task: 't', tools: ['write'] });
        message = out.message;
      },
    });
    expect(message).toContain('You do not hold write');
  });

  it('does not give a child the agents grant unless it is asked for', async () => {
    let offered: string[] = [];
    await runTeam({
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'plain', task: 't' }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        plain: async (api) => {
          const tool = api.request.toolDefinitions.find(
            (d) => (d as { name?: string }).name === AGENT,
          ) as { operations: string[] } | undefined;
          offered = tool?.operations ?? [];
        },
      },
    });
    expect(offered).toEqual(['message', 'inbox']);
  });

  it('keeps a child inside the write scope of its parent', async () => {
    let wide = '';
    let inside = '';
    await runTeam({
      config: { permissions: { allow: ['read', 'write', 'agents'], writeScope: ['src/**'] } },
      lead: async (api) => {
        wide = (
          await api.call(AGENT, 'spawn', { name: 'wide', task: 't', writeScope: ['docs/**'] })
        ).message;
        const ok = must(
          await api.call(AGENT, 'spawn', { name: 'narrow', task: 't', writeScope: ['src/a/**'] }),
        );
        inside = String(ok.writeScope);
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        narrow: async (api) => {
          const outside = await api.call('workspace.file', 'create', {
            path: 'src/b/no.ts',
            content: 'x',
          });
          expect(outside.ok).toBe(false);
          expect(outside.message).toContain('write scope');
          must(await api.call('workspace.file', 'create', { path: 'src/a/yes.ts', content: 'x' }));
        },
      },
    });
    expect(wide).toContain('not inside your own write scope');
    expect(inside).toBe('src/a/**');
  });

  it('gives a child that names no scope the parent scope, not "anywhere"', async () => {
    let denied = false;
    await runTeam({
      config: { permissions: { allow: ['read', 'write', 'agents'], writeScope: ['src/**'] } },
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'inherit', task: 't' }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        inherit: async (api) => {
          denied = !(
            await api.call('workspace.file', 'create', { path: 'other/x.ts', content: 'x' })
          ).ok;
        },
      },
    });
    expect(denied).toBe(true);
  });

  it('roots a child at its workspaceSubdir and keeps it from reading beside it', async () => {
    const workspace = scratch('claw-team-sub-');
    makeDir(workspace, 'a');
    let escaped = true;
    const run = await runTeam({
      workspace,
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'sub', task: 't', workspaceSubdir: 'a' }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        sub: async (api) => {
          must(await api.call('workspace.file', 'create', { path: 'in.txt', content: 'x' }));
          escaped = (await api.call('workspace.file', 'read', { path: '../outside.txt' })).ok;
        },
      },
    });
    expect(readIn(run.workspace, 'a/in.txt')).toBe('x');
    expect(escaped).toBe(false);
  });

  it('refuses a workspaceSubdir that climbs out of the workspace', async () => {
    let message = '';
    await runTeam({
      lead: async (api) => {
        message = (
          await api.call(AGENT, 'spawn', { name: 'up', task: 't', workspaceSubdir: '../elsewhere' })
        ).message;
      },
    });
    expect(message).toContain('inside the workspace');
  });

  it('never lets a child raise the permission mode: approvals go to the parent', async () => {
    const asked: string[] = [];
    await runTeam({
      config: {
        permissionMode: 'ask',
        permissions: {
          allow: ['read', 'write', 'agents'],
          approve: (request) => {
            asked.push(`${request.toolName}.${request.operation}:${request.category}`);
            return true;
          },
        },
      },
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', { name: 'asked', task: 't', tools: ['read', 'write'] }),
        );
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: { asked: writer('f.ts', 'done') },
    });
    expect(asked).toContain('agent.team.spawn:agents');
    expect(asked).toContain('workspace.file.create:write');
  });

  it('a child with no approver in ask mode is denied, never allowed', async () => {
    let created = true;
    const run = await runTeam({
      config: {
        permissionMode: 'ask',
        permissions: {
          allow: ['read', 'write', 'agents'],
          approve: (request) => request.category === 'agents',
        },
      },
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'deny', task: 't', tools: ['read', 'write'] }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 20_000 }));
      },
      children: {
        deny: async (api) => {
          created = (await api.call('workspace.file', 'create', { path: 'n.ts', content: 'x' })).ok;
        },
      },
    });
    expect(created).toBe(false);
    expect(readIn(run.workspace, 'n.ts')).toBeUndefined();
  });

  it('is not offered in plan mode, where agents is removed with every write', async () => {
    let seen = true;
    await runTeam({
      config: { permissionMode: 'plan', permissions: { allow: ['read', 'write', 'agents'] } },
      lead: async (api) => {
        seen = api.request.toolDefinitions.some((d) => (d as { name?: string }).name === AGENT);
      },
    });
    expect(seen).toBe(false);
  });

  it('refuses a spawn when approval is declined in ask mode', async () => {
    let denied = '';
    await runTeam({
      config: {
        permissionMode: 'ask',
        permissions: { allow: ['read', 'agents'], approve: () => false },
      },
      lead: async (api) => {
        denied = (await api.call(AGENT, 'spawn', { name: 'no', task: 't' })).message;
      },
    });
    expect(denied.length).toBeGreaterThan(0);
  });
});

describe('agent.team: limits', () => {
  it('carves child budgets from what the parent has left', async () => {
    const budgets: number[] = [];
    let refused = '';
    await runTeam({
      maxToolCalls: 40,
      lead: async (api) => {
        for (const name of ['b1', 'b2', 'b3']) {
          const out = await api.call(AGENT, 'spawn', {
            name,
            task: 't',
            tools: ['read'],
            budget: { maxToolCalls: 25 },
          });
          if (out.ok)
            budgets.push((out.structured.budget as { maxToolCalls: number }).maxToolCalls);
          else refused = out.message;
        }
        await api.call(AGENT, 'cancel', { name: 'b1' });
        await api.call(AGENT, 'cancel', { name: 'b2' });
      },
      children: {
        b1: async (api) => nap(5_000, api.signal),
        b2: async (api) => nap(5_000, api.signal),
      },
    });
    // 40 calls: the lead used 3 spawns before this read of the room, so b1 gets 25 of what is left.
    expect(budgets[0]).toBe(25);
    expect(budgets[1]).toBeLessThan(25);
    expect(budgets[1]).toBeGreaterThanOrEqual(8);
    expect(refused).toContain('to spare');
  });

  it('stops a child that runs past its own tool-call allowance', async () => {
    let state = '';
    let outcome = '';
    await runTeam({
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', { name: 'busy', task: 't', budget: { maxToolCalls: 8 } }),
        );
        const done = must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
        const child = (done.children as { state: string; outcome?: string }[])[0];
        state = child?.state ?? '';
        outcome = child?.outcome ?? '';
      },
      children: {
        busy: async (api) => {
          for (let index = 0; index < 20; index += 1) {
            await api.call('workspace.file', 'create', {
              path: `f${String(index)}.txt`,
              content: String(index),
            });
          }
        },
      },
    });
    expect(state).toBe('failed');
    expect(outcome).toBe('exhausted');
  });

  it('refuses a child that would start deeper than two levels', async () => {
    const refusals: string[] = [];
    let offered: string[] = [];
    await runTeam({
      lead: async (api) => {
        must(
          await api.call(AGENT, 'spawn', { name: 'lvl1', task: 't', tools: ['read', 'agents'] }),
        );
        must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
      },
      children: {
        lvl1: async (api) => {
          must(
            await api.call(AGENT, 'spawn', { name: 'lvl2', task: 't', tools: ['read', 'agents'] }),
          );
          must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
        },
        lvl2: async (api) => {
          const tool = api.request.toolDefinitions.find(
            (d) => (d as { name?: string }).name === AGENT,
          ) as { operations: string[] } | undefined;
          offered = tool?.operations ?? [];
          const out = await api.call(AGENT, 'spawn', { name: 'lvl3', task: 't' });
          refusals.push(out.message);
        },
      },
    });
    expect(offered).toEqual(['message', 'inbox']);
    expect(refusals[0]).toContain('not permitted');
  });

  it('starts at most eight children in a run', async () => {
    let ninth = '';
    await runTeam({
      maxToolCalls: 2_000,
      lead: async (api) => {
        for (let index = 1; index <= 8; index += 1) {
          must(
            await api.call(AGENT, 'spawn', {
              name: `w${String(index)}`,
              task: 't',
              tools: ['read'],
              budget: { maxToolCalls: 9 },
            }),
          );
        }
        ninth = (await api.call(AGENT, 'spawn', { name: 'w9', task: 't', tools: ['read'] }))
          .message;
        must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
      },
    });
    expect(ninth).toContain('at most 8');
  });

  it('runs at most --max-agents at once and queues the rest', async () => {
    let running = 0;
    let peak = 0;
    const states: string[] = [];
    const work = async (api: ScriptApi): Promise<void> => {
      running += 1;
      peak = Math.max(peak, running);
      await nap(150, api.signal);
      running -= 1;
    };
    await runTeam({
      config: { maxAgents: 2 },
      lead: async (api) => {
        for (const name of ['q1', 'q2', 'q3', 'q4']) {
          const out = must(await api.call(AGENT, 'spawn', { name, task: 't', tools: ['read'] }));
          states.push(String(out.state));
        }
        const waited = must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
        expect(waited.done).toBe(true);
      },
      children: { q1: work, q2: work, q3: work, q4: work },
    });
    expect(states).toEqual(['running', 'running', 'queued', 'queued']);
    expect(peak).toBe(2);
  });

  it('refuses the same name twice and reserved names', async () => {
    const messages: string[] = [];
    await runTeam({
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'dup', task: 't', tools: ['read'] }));
        messages.push((await api.call(AGENT, 'spawn', { name: 'dup', task: 't' })).message);
        messages.push((await api.call(AGENT, 'spawn', { name: 'lead', task: 't' })).message);
        messages.push((await api.call(AGENT, 'spawn', { name: 'Bad Name', task: 't' })).message);
        must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
      },
    });
    expect(messages[0]).toContain('already exists');
    expect(messages[1]).toContain('reserved');
    expect(messages[2]).toContain('not a valid name');
  });
});

describe('agent.team: two children, one file', () => {
  it('refuses the second child on an overlapping scope while the first works', async () => {
    let second = '';
    let other = '';
    await runTeam({
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'one', task: 't', writeScope: ['lib/**'] }));
        second = (
          await api.call(AGENT, 'spawn', { name: 'two', task: 't', writeScope: ['lib/util/**'] })
        ).message;
        other = String(
          must(await api.call(AGENT, 'spawn', { name: 'three', task: 't', writeScope: ['app/**'] }))
            .name,
        );
        await api.call(AGENT, 'cancel', { name: 'one' });
        // Once the first is over its files are free.
        must(await api.call(AGENT, 'spawn', { name: 'four', task: 't', writeScope: ['lib/**'] }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
      },
      children: {
        one: async (api) => nap(2_000, api.signal),
        three: async () => undefined,
        four: async () => undefined,
      },
    });
    expect(second).toContain('already changing lib/**');
    expect(second).toContain('isolation "worktree"');
    expect(other).toBe('three');
  });

  it('does not count a read-only child as a writer', async () => {
    await runTeam({
      lead: async (api) => {
        must(await api.call(AGENT, 'spawn', { name: 'r1', task: 't', tools: ['read'] }));
        must(await api.call(AGENT, 'spawn', { name: 'r2', task: 't', tools: ['read'] }));
        must(await api.call(AGENT, 'wait', { timeoutMs: 30_000 }));
      },
    });
  });
});
