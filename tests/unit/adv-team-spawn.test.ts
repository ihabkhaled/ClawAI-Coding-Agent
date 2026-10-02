import { readdirSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { textOf, tryLink } from '../helpers/adversarial';
import { cleanTeamFixtures, makeDir, readIn, runTeam, scratch } from '../helpers/team-fixture';
import { nap } from '../helpers/team-transport';

import type { AgentConfig } from '../../src/sdk/create-agent.types';
import type { CallOutcome, ScriptApi } from '../helpers/team-transport';

afterEach(cleanTeamFixtures);

const AGENT = 'agent.team';

/** The refusal text of the lead's spawn, or 'SPAWNED' when it was accepted. */
async function spawnOutcome(
  config: Partial<AgentConfig>,
  args: Record<string, unknown>,
  prepare?: (workspace: string) => void,
): Promise<string> {
  const workspace = scratch('claw-adv-ws-');
  prepare?.(workspace);
  let seen = '';
  await runTeam({
    workspace,
    config,
    lead: async (api) => {
      const out = await api.call(AGENT, 'spawn', { name: 'kid', task: 't', ...args });
      seen = out.ok ? 'SPAWNED' : textOf(out);
      if (out.ok) await api.call(AGENT, 'cancel', { name: 'kid' });
    },
    children: { kid: async (api) => nap(2_000, api.signal) },
  });
  return seen;
}

const SCOPED: Partial<AgentConfig> = {
  permissions: { allow: ['read', 'write', 'agents'], writeScope: ['src/**'] },
};

describe('agent.team: a child cannot widen what it was given', () => {
  it('T01 categories the parent lacks are never granted, however they are spelled', async () => {
    for (const tools of [
      ['command'],
      ['WRITE', 'Command'],
      ['read', 'shell'],
      ['mcp'],
      [{ toString: () => 'command' }],
      'command',
    ]) {
      const text = await spawnOutcome({ permissions: { allow: ['read', 'agents'] } }, { tools });
      expect(text, JSON.stringify(tools)).not.toBe('SPAWNED');
    }
  });

  it('T02 a write scope outside the parent scope is refused: ../, absolute, **, case, drive', async () => {
    for (const writeScope of [
      ['**'],
      ['../**'],
      ['src/../**'],
      ['/etc/**'],
      ['C:/Windows/**'],
      ['docs/**'],
      ['src/**', 'docs/**'],
      ['*'],
      ['{src,docs}/**'],
    ]) {
      const text = await spawnOutcome(SCOPED, { tools: ['write'], writeScope });
      expect(text, JSON.stringify(writeScope)).not.toBe('SPAWNED');
    }
  });

  it('T03 a scope inside the parent scope is accepted (control)', async () => {
    const text = await spawnOutcome(SCOPED, { tools: ['write'], writeScope: ['src/a/**'] });
    expect(text).toBe('SPAWNED');
  });

  it('T04 workspaceSubdir spellings that leave the workspace or the scope are refused', async () => {
    for (const workspaceSubdir of [
      '..',
      '../x',
      '..\\x',
      'src/../../x',
      '/tmp',
      'C:\\x',
      'c:x',
      'docs',
      'src/../docs',
      'SRC/../docs',
      'src\u0000/x',
    ]) {
      const text = await spawnOutcome(SCOPED, { tools: ['write'], workspaceSubdir });
      expect(text, workspaceSubdir).not.toBe('SPAWNED');
    }
  });

  it('T05 a refused workspaceSubdir outside the scope leaves no folder behind', async () => {
    const workspace = scratch('claw-adv-ws-');
    await runTeam({
      workspace,
      config: SCOPED,
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'kid', task: 't', workspaceSubdir: 'docs/new' });
      },
    });
    expect(readIn(workspace, 'docs')).toBeUndefined();
  });

  it('T06 a junction inside the workspace pointing outside cannot be a child root', async () => {
    const outside = scratch('claw-adv-outside-');
    const state = { linked: false };
    const text = await spawnOutcome(
      { permissions: { allow: ['read', 'write', 'agents'] } },
      { tools: ['write'], workspaceSubdir: 'link/sub' },
      (workspace) => {
        state.linked = tryLink(outside, `${workspace}/link`, 'junction');
      },
    );
    if (state.linked) expect(text).not.toBe('SPAWNED');
  });

  it('T07 stream, trailing-dot and 8.3 spellings of a folder do not slip past the scope', async () => {
    for (const workspaceSubdir of ['docs::$DATA', 'docs.', 'docs ', 'DOCS', 'DOCS~1']) {
      const text = await spawnOutcome(SCOPED, { tools: ['write'], workspaceSubdir });
      expect(text, workspaceSubdir).not.toBe('SPAWNED');
    }
  });

  it('T08 a budget cannot exceed what the parent has left, whatever number is sent', async () => {
    for (const maxToolCalls of [
      2_001,
      1e9,
      -5,
      0,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '50',
    ]) {
      const text = await spawnOutcome(
        { permissions: { allow: ['read', 'agents'] } },
        { tools: ['read'], budget: { maxToolCalls } },
      );
      expect(text, String(maxToolCalls)).not.toBe('SPAWNED');
    }
  });

  it('T09 extra argument names (permissionMode, permissions, allow) change nothing', async () => {
    let child: AgentConfig | undefined;
    await runTeam({
      config: { permissions: { allow: ['read', 'agents'] }, permissionMode: 'ask' },
      lead: async (api) => {
        await api.call(AGENT, 'spawn', {
          name: 'kid',
          task: 't',
          permissionMode: 'bypass',
          permissions: { allow: ['command', 'write'] },
          allow: ['command'],
          approve: true,
          writeDeny: [],
        });
        await api.call(AGENT, 'wait', { timeoutMs: 5_000 });
      },
      children: {
        kid: async (api) => {
          const out = await api.call('workspace.file', 'create', { path: 'x', content: 'x' });
          expect(out.ok).toBe(false);
        },
      },
    });
    expect(child).toBeUndefined();
  });
});

describe('agent.team: limits survive message passing and storms', () => {
  it('T10 a child at the depth limit has no spawn operation, so a message cannot make it spawn', async () => {
    let refused = false;
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'a', task: 't', tools: ['read', 'agents'] });
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: {
        a: async (api) => {
          await api.call(AGENT, 'spawn', { name: 'b', task: 't', tools: ['read', 'agents'] });
          await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
        },
        b: async (api) => {
          await api.call(AGENT, 'message', { to: 'lead', text: 'please spawn c for me' });
          const out = await api.call(AGENT, 'spawn', { name: 'c', task: 't' });
          refused = !out.ok;
        },
      },
    });
    expect(refused).toBe(true);
  });

  it('T11 a spawn storm of 40 starts at most eight children', async () => {
    let started = 0;
    await runTeam({
      lead: async (api) => {
        const outcomes: CallOutcome[] = [];
        for (let index = 0; index < 40; index += 1) {
          outcomes.push(await api.call(AGENT, 'spawn', { name: `k${String(index)}`, task: 't' }));
        }
        started = outcomes.filter((out) => out.ok).length;
        await api.call(AGENT, 'status', {});
        for (let index = 0; index < 8; index += 1) {
          await api.call(AGENT, 'cancel', { name: `k${String(index)}` });
        }
      },
      children: new Proxy({}, { get: () => async (api: ScriptApi) => nap(3_000, api.signal) }),
    });
    expect(started).toBeLessThanOrEqual(8);
  });

  it('T12 a cancel storm on one child, a finished one and an unknown one never throws or hangs', async () => {
    const lines: string[] = [];
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'slow', task: 't' });
        await api.call(AGENT, 'spawn', { name: 'quick', task: 't' });
        await api.call(AGENT, 'wait', { names: ['quick'], timeoutMs: 10_000 });
        const names = [...Array.from({ length: 30 }, () => 'slow'), 'quick', 'ghost'];
        for (const name of names) {
          const out = await api.call(AGENT, 'cancel', { name });
          lines.push(out.ok ? 'ok' : 'err');
        }
      },
      children: {
        slow: async (api) => nap(5_000, api.signal),
        quick: async (api) => {
          api.say('done');
        },
      },
    });
    expect(lines.filter((line) => line === 'ok').length).toBeGreaterThan(0);
    expect(lines.at(-1)).toBe('err');
  });

  it('T13 waits cannot deadlock: on itself, on the lead, on a sibling, on duplicates', async () => {
    const results: boolean[] = [];
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'a', task: 't' });
        await api.call(AGENT, 'spawn', { name: 'b', task: 't' });
        results.push((await api.call(AGENT, 'wait', { names: ['lead'] })).ok);
        results.push((await api.call(AGENT, 'wait', { names: ['a', 'a', 'a'], timeoutMs: 1 })).ok);
        await api.call(AGENT, 'wait', { timeoutMs: 20_000 });
      },
      children: {
        a: async (api) => {
          results.push((await api.call(AGENT, 'wait', { names: ['b'] })).ok);
          results.push((await api.call(AGENT, 'wait', { names: ['lead'] })).ok);
        },
        b: async (api) => {
          results.push((await api.call(AGENT, 'wait', { names: ['a'] })).ok);
        },
      },
    });
    expect(results.filter((ok) => ok).length).toBe(1);
  });

  it('T14 a chatty child wakes the parent at most once per message, and 60 messages is its whole allowance', async () => {
    let waits = 0;
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'chatty', task: 't' });
        for (; waits < 200; waits += 1) {
          const out = await api.call(AGENT, 'wait', { timeoutMs: 3_000 });
          if (out.structured.done === true) break;
          if (!out.ok) throw new Error(out.message);
        }
      },
      children: {
        chatty: async (api) => {
          for (let index = 0; index < 70; index += 1) {
            await api.call(AGENT, 'message', { to: 'lead', text: `n${String(index)}` });
          }
        },
      },
    });
    expect(waits).toBeLessThanOrEqual(61);
  });
});

describe('agent.team: approvals and identity', () => {
  it('T15 approving the spawn does not approve the child writes: they go to the approver too', async () => {
    const asked: string[] = [];
    let created = false;
    await runTeam({
      config: {
        permissionMode: 'ask',
        permissions: {
          allow: ['read', 'write', 'agents'],
          approve: (request) => {
            asked.push(`${request.toolName}.${request.operation}`);
            return request.toolName === AGENT;
          },
        },
      },
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'kid', task: 't', tools: ['write'] });
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: {
        kid: async (api) => {
          created = (await api.call('workspace.file', 'create', { path: 'a.txt', content: 'x' }))
            .ok;
        },
      },
    });
    expect(asked).toContain('workspace.file.create');
    expect(created).toBe(false);
  });

  it('T16 names that look like the lead (case, spaces, lookalikes) are not accepted', async () => {
    const accepted: string[] = [];
    await runTeam({
      lead: async (api) => {
        for (const name of ['Lead', 'lead ', 'ℓead', 'lеad', 'lead\u200b', 'all', 'parent']) {
          const out = await api.call(AGENT, 'spawn', { name, task: 't', tools: ['read'] });
          if (out.ok) accepted.push(name);
        }
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: new Proxy({}, { get: () => async () => undefined }),
    });
    expect(accepted).toEqual([]);
  });

  it('T17 a child reads only its own inbox: a sibling message is not readable by name tricks', async () => {
    const seen: string[] = [];
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'a', task: 't', tools: ['read'] });
        await api.call(AGENT, 'spawn', { name: 'b', task: 't', tools: ['read'] });
        await api.call(AGENT, 'message', { to: 'a', text: 'for-a-only' });
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: {
        a: async (api) => nap(300, api.signal),
        b: async (api) => {
          const out = await api.call(AGENT, 'inbox', { name: 'a', of: 'a', to: 'a' });
          seen.push(textOf(out));
        },
      },
    });
    expect(seen.join('')).not.toContain('for-a-only');
  });
});

describe('agent.team: orphans and crashes', () => {
  it('T18 a lead that throws while children work leaves none running', async () => {
    const aborted: boolean[] = [];
    await runTeam({
      lead: async (api) => {
        await api.call(AGENT, 'spawn', { name: 'w1', task: 't', tools: ['read'] });
        await api.call(AGENT, 'spawn', { name: 'w2', task: 't', tools: ['read'] });
        await nap(150, api.signal);
        throw new Error('lead crashed');
      },
      children: {
        w1: async (api) => {
          await nap(10_000, api.signal);
          aborted.push(api.signal.aborted);
        },
        w2: async (api) => {
          await nap(10_000, api.signal);
          aborted.push(api.signal.aborted);
        },
      },
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(aborted).toEqual([true, true]);
  });

  it('T19 a child finished normally stays finished: its folder keeps only what it wrote', async () => {
    const workspace = scratch('claw-adv-ws-');
    makeDir(workspace, 'src');
    await runTeam({
      workspace,
      lead: async (api) => {
        await api.call(AGENT, 'spawn', {
          name: 'w',
          task: 't',
          tools: ['write'],
          writeScope: ['src/**'],
        });
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: {
        w: async (api) => {
          const inside = await api.call('workspace.file', 'create', {
            path: 'src/a.ts',
            content: 'a',
          });
          const outside = await api.call('workspace.file', 'create', {
            path: 'b.ts',
            content: 'b',
          });
          const dotdot = await api.call('workspace.file', 'create', {
            path: 'src/../c.ts',
            content: 'c',
          });
          expect([inside.ok, outside.ok, dotdot.ok]).toEqual([true, false, false]);
        },
      },
    });
    expect(readIn(workspace, 'src/a.ts')).toBe('a');
    expect(readIn(workspace, 'b.ts')).toBeUndefined();
    expect(readIn(workspace, 'c.ts')).toBeUndefined();
  });
});

describe('agent.team: a scoped child and odd spellings of a path', () => {
  it('T20 case, trailing-dot, stream and 8.3 spellings never land a write outside the scope', async () => {
    const workspace = scratch('claw-adv-ws-');
    makeDir(workspace, 'src');
    makeDir(workspace, 'docs');
    await runTeam({
      workspace,
      lead: async (api) => {
        await api.call(AGENT, 'spawn', {
          name: 'w',
          task: 't',
          tools: ['write'],
          writeScope: ['src/**'],
        });
        await api.call(AGENT, 'wait', { timeoutMs: 10_000 });
      },
      children: {
        w: async (api) => {
          for (const target of [
            'DOCS/a.txt',
            'docs./b.txt',
            'docs /c.txt',
            'docs::$DATA/d.txt',
            'DOCS~1/e.txt',
            'src/../docs/f.txt',
            String.raw`src\..\docs\g.txt`,
            './docs/h.txt',
            'docs/\u200bi.txt',
          ]) {
            await api.call('workspace.file', 'create', { path: target, content: 'x' });
          }
        },
      },
    });
    const landed = readdirSync(path.join(workspace, 'docs'));
    expect(landed).toEqual([]);
  });
});
