import { describe, expect, it } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createAgent } from '../../src/sdk/create-agent';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';

const readCall = (index: number): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: `i-${String(index)}`,
    toolName: 'workspace.file',
    operation: 'read',
    invocation: { arguments: { path: 'package.json' } },
  },
});

function transport(
  events: (signal?: AbortSignal) => AsyncIterable<HeadlessStreamEvent>,
  submitted: unknown[] = [],
): RuntimeTransportPort {
  return {
    signIn: () => Promise.resolve('t'),
    createThread: () => Promise.resolve('thread-1'),
    startRun: () => Promise.resolve({ runId: 'run-1', generation: 'gen-1' }),
    submitResult: (_token, _run, _epochs, result) => {
      submitted.push(result);
      return Promise.resolve({});
    },
    events: (_token, _run, signal) => events(signal),
  };
}

async function* threeReadsThenDone(): AsyncGenerator<HeadlessStreamEvent> {
  yield await Promise.resolve(readCall(1));
  yield await Promise.resolve(readCall(2));
  yield await Promise.resolve(readCall(3));
  yield await Promise.resolve({ type: 'run.completed' });
}

function agentWith(events: (signal?: AbortSignal) => AsyncIterable<HeadlessStreamEvent>) {
  return createAgent({
    auth: { token: 'token' },
    workspaceRoot: process.cwd(),
    transport: transport(events),
  });
}

describe('--max-tool-calls and --max-duration flags', () => {
  const parse = (...args: string[]) => parseHeadlessArgs(['-p', 'x', ...args], {}, process.cwd());

  it('reads seconds as milliseconds and a count as given', () => {
    const parsed = parse('--max-tool-calls', '7', '--max-duration', '90');

    expect(parsed.kind === 'run' && parsed.invocation.maxToolCalls).toBe(7);
    expect(parsed.kind === 'run' && parsed.invocation.maxDurationMs).toBe(90_000);
  });

  it.each([
    ['--max-tool-calls', '0'],
    ['--max-tool-calls', '1.5'],
    ['--max-tool-calls', 'many'],
    ['--max-duration', '0'],
    ['--max-duration', '-3'],
    ['--max-duration', '999999'],
  ])('rejects %s %s as a usage error', (flag, value) => {
    expect(parse(flag, value).kind).toBe('usage');
  });

  it('leaves both unset when neither is given', () => {
    const parsed = parse();

    expect(parsed.kind === 'run' && parsed.invocation.maxToolCalls).toBeUndefined();
    expect(parsed.kind === 'run' && parsed.invocation.maxDurationMs).toBeUndefined();
  });

  it('parses --mcp-login without a prompt, and asks for the config that names the server', () => {
    const login = parseHeadlessArgs(['--mcp-login', 's', '--mcp-config', 'c.json'], {}, '/w');

    expect(login.kind).toBe('login');
    expect(parseHeadlessArgs(['--mcp-login', 's'], {}, '/w').kind).toBe('usage');
  });
});

describe('run guards in the SDK', () => {
  it('stops at the tool-call limit: exit 5, the extra call is refused and never runs', async () => {
    const events: AgentEvent[] = [];

    const result = await agentWith(threeReadsThenDone).run('go', {
      maxToolCalls: 2,
      onEvent: (event) => events.push(event),
    });

    const ran = events.filter((event) => event.type === 'tool.result');
    const types = events.map((event) => event.type);
    expect(result.outcome).toBe('exhausted');
    expect(result.exitCode).toBe(5);
    expect(result.toolCalls).toBe(2);
    expect(ran).toHaveLength(2);
    expect(result.error).toContain('more than 2 tool call');
    expect(events.find((event) => event.type === 'budget.exhausted')).toEqual({
      type: 'budget.exhausted',
      budget: 'tool-calls',
      limit: 2,
    });
    expect(types.at(-1)).toBe('run.finished');
    expect(types.indexOf('budget.exhausted')).toBeLessThan(types.indexOf('run.finished'));
  });

  it('does not trip when the run stays within the limit', async () => {
    const result = await agentWith(threeReadsThenDone).run('go', { maxToolCalls: 3 });

    expect(result.outcome).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
  });

  it('stops a run that is still going at the duration limit and cancels the stream', async () => {
    const events: AgentEvent[] = [];
    async function* hangs(signal?: AbortSignal): AsyncGenerator<HeadlessStreamEvent> {
      yield await Promise.resolve({ type: 'model.delta', payload: { text: 'hi' } });
      await new Promise<void>((resolve) => {
        signal?.addEventListener(
          'abort',
          () => {
            resolve();
          },
          { once: true },
        );
      });
    }

    const result = await agentWith(hangs).run('go', {
      maxDurationMs: 40,
      onEvent: (event) => events.push(event),
    });

    expect(result.outcome).toBe('exhausted');
    expect(result.exitCode).toBe(5);
    expect(result.text).toBe('hi');
    expect(events).toContainEqual({ type: 'budget.exhausted', budget: 'duration', limit: 40 });
  });

  it('still reports a caller abort as cancelled when a guard is armed', async () => {
    const controller = new AbortController();
    async function* hangs(signal?: AbortSignal): AsyncGenerator<HeadlessStreamEvent> {
      yield await Promise.resolve({ type: 'model.delta', payload: { text: 'x' } });
      controller.abort();
      if (signal?.aborted !== true) throw new Error('the guard signal did not follow the caller');
    }

    const result = await agentWith(hangs).run('go', {
      maxDurationMs: 60_000,
      maxToolCalls: 5,
      signal: controller.signal,
    });

    expect(result.outcome).toBe('cancelled');
    expect(result.exitCode).toBe(130);
  });

  it.each([{ maxToolCalls: 0 }, { maxDurationMs: -1 }, { maxToolCalls: 1.5 }])(
    'refuses %j before starting',
    async (limits) => {
      await expect(agentWith(threeReadsThenDone).run('go', limits)).rejects.toThrow(RangeError);
    },
  );
});

describe('run guards through the CLI', () => {
  it('exits 5 and writes the budget event before run.finished in stream-json', async () => {
    const lines: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'x', '--output-format', 'stream-json', '--max-tool-calls', '1'],
      { CLAW_TOKEN: 'token', CLAW_STATE_DIR: process.cwd() },
      { stdout: (text) => lines.push(text), stderr: () => undefined },
      {
        cwd: process.cwd(),
        transport: transport(threeReadsThenDone),
        sessions: { latest: () => Promise.resolve(undefined), remember: () => Promise.resolve() },
      },
    );

    const parsed = lines.map((line) => JSON.parse(line) as { type: string; result?: unknown });
    const types = parsed.map((event) => event.type);
    expect(code).toBe(5);
    expect(types.at(-1)).toBe('run.finished');
    expect(types.filter((type) => type === 'budget.exhausted')).toHaveLength(1);
    expect(types.indexOf('budget.exhausted')).toBeLessThan(types.length - 1);
    expect(parsed.at(-1)?.result).toMatchObject({
      outcome: 'exhausted',
      exitCode: 5,
      toolCalls: 1,
    });
  });

  it('names the guard on stderr in text mode', async () => {
    const err: string[] = [];

    const code = await runHeadlessCli(
      ['-p', 'x', '--max-tool-calls', '1'],
      { CLAW_TOKEN: 'token', CLAW_STATE_DIR: process.cwd() },
      { stdout: () => undefined, stderr: (text) => err.push(text) },
      {
        cwd: process.cwd(),
        transport: transport(threeReadsThenDone),
        sessions: { latest: () => Promise.resolve(undefined), remember: () => Promise.resolve() },
      },
    );

    expect(code).toBe(5);
    expect(err.join('')).toContain('[budget] tool-calls limit 1 reached');
  });
});
