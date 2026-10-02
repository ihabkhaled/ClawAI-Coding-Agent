import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { writeEvent } from '../../src/headless/headless-output';
import { cleanTeamFixtures, childName, must, scratch } from '../helpers/team-fixture';
import { teamTransport } from '../helpers/team-transport';

import type { HeadlessInvocation } from '../../src/headless/headless-args.types';

afterEach(cleanTeamFixtures);

function invocation(argv: string[]): HeadlessInvocation {
  const parsed = parseHeadlessArgs(['-p', 'task', ...argv], {}, process.cwd());
  if (parsed.kind !== 'run') throw new Error(JSON.stringify(parsed));
  return parsed.invocation;
}

describe('--allow-tools agents and --max-agents', () => {
  it('names agents as a tool category and reads the concurrency', () => {
    const parsed = invocation(['--allow-tools', 'read,write,agents', '--max-agents', '3']);
    expect(parsed.allowTools).toEqual(['read', 'write', 'agents']);
    expect(parsed.maxAgents).toBe(3);
  });

  it('leaves agents out of every default, even with a permission mode', () => {
    expect(invocation([]).allowTools).toEqual(['read', 'git']);
    expect(invocation(['--permission-mode', 'ask']).allowTools).not.toContain('agents');
  });

  it.each(['0', '9', '-1', 'two', '2.5', ''])('rejects --max-agents %s', (value) => {
    const parsed = parseHeadlessArgs(['-p', 'x', '--max-agents', value], {}, process.cwd());
    expect(parsed.kind).toBe('usage');
  });

  it('says what it is in the usage text', () => {
    const parsed = parseHeadlessArgs(['--help'], {}, process.cwd());
    expect(parsed.kind).toBe('help');
  });
});

describe('a headless run that delegates', () => {
  it('writes the agent events to the stream, with run.finished last', async () => {
    vi.stubEnv('CLAW_STATE_DIR', scratch('claw-cli-state-'));
    const workspace = scratch('claw-cli-ws-');
    const { transport } = teamTransport((prompt) => {
      if (childName(prompt) === undefined) {
        return async (api) => {
          must(
            await api.call('agent.team', 'spawn', {
              name: 'doer',
              task: 'write x',
              tools: ['read', 'write'],
              writeScope: ['x/**'],
            }),
          );
          must(await api.call('agent.team', 'wait', { timeoutMs: 20_000 }));
          api.say('all done');
        };
      }
      return async (api) => {
        must(await api.call('workspace.file', 'create', { path: 'x/a.txt', content: 'a' }));
        api.say('wrote x/a.txt');
      };
    });
    const out: string[] = [];
    const code = await runHeadlessCli(
      [
        '-p',
        'build',
        '--allow-tools',
        'read,write,agents',
        '--output-format',
        'stream-json',
        '--workspace',
        workspace,
      ],
      { CLAW_TOKEN: 't' },
      { stdout: (text) => out.push(text), stderr: () => undefined },
      { cwd: workspace, transport },
    );
    expect(code).toBe(0);
    const lines = out
      .join('')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { type: string; name?: string });
    const types = lines.map((line) => line.type);
    expect(types).toContain('agent.spawned');
    expect(types).toContain('agent.finished');
    expect(types.at(-1)).toBe('run.finished');
    expect(types.indexOf('agent.spawned')).toBeLessThan(types.indexOf('agent.finished'));
  });

  it('prints a plain line for each agent event in text mode', () => {
    const lines: string[] = [];
    const io = { stdout: () => undefined, stderr: (text: string) => lines.push(text) };
    writeEvent(
      'text',
      {
        type: 'agent.spawned',
        name: 'a',
        parent: 'lead',
        depth: 1,
        task: 't',
        tools: ['read'],
        isolation: 'none',
        maxToolCalls: 80,
        maxDurationSec: 600,
      },
      io,
    );
    writeEvent('text', { type: 'agent.message', from: 'a', to: 'lead', chars: 5 }, io);
    writeEvent(
      'text',
      {
        type: 'agent.finished',
        name: 'a',
        parent: 'lead',
        state: 'failed',
        outcome: 'exhausted',
        toolCalls: 80,
        durationMs: 61_000,
        files: 2,
        error: 'Stopped',
      },
      io,
    );
    expect(lines).toEqual([
      '[agent] a started by lead (read; 80 calls, 600s)\n',
      '[agent] a -> lead: 5 chars\n',
      '[agent] a failed, 80 call(s), 61s: Stopped\n',
    ]);
  });
});
