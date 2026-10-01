import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { classifyFailure } from '../../src/headless/retry-policy';
import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { createAgent } from '../../src/sdk/create-agent';
import { resolveToolAlias } from '../../src/sdk/tool-alias';
import { COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';
import type { DoneCheck } from '../../src/sdk/done-checks.types';

const created: string[] = [];
let workspace = '';
const saved = process.env.CLAW_STATE_DIR;

beforeEach(() => {
  const state = mkdtempSync(path.join(tmpdir(), 'claw-state-'));
  workspace = mkdtempSync(path.join(tmpdir(), 'claw-dogfood-'));
  created.push(state, workspace);
  process.env.CLAW_STATE_DIR = state;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const failing = (label: string): DoneCheck => ({
  label,
  executable: process.execPath,
  args: ['-e', 'console.error("missing-flag-xyz"); process.exit(3)'],
});

async function run(
  scripts: Parameters<typeof scriptedRuns>[0],
  options: { doneChecks?: DoneCheck[]; autoContinue?: number } = {},
) {
  const runtime = scriptedRuns(scripts);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 'zq9xk' },
    workspaceRoot: workspace,
    transport: runtime.transport,
    ...(options.doneChecks === undefined ? {} : { doneChecks: options.doneChecks }),
  });
  const result = await agent.run('build it', {
    autoContinue: options.autoContinue,
    onEvent: (event) => events.push(event),
  });
  return { runtime, events, result };
}

const toolCall = (toolName: string, operation: string): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: 'i-1',
    toolName,
    operation,
    invocation: { arguments: { path: 'a.txt' } },
  },
});

describe('runtime failure reason', () => {
  it('puts the redacted reason of a failed run in error', async () => {
    const { result } = await run([
      [{ type: 'run.failed', payload: { code: 'MODEL_ERROR', message: 'upstream said no' } }],
    ]);

    expect(result).toMatchObject({ outcome: 'failed', exitCode: 1 });
    expect(result.error).toContain('MODEL_ERROR');
    expect(result.error).toContain('upstream said no');
  });
});

describe('unknown tool names', () => {
  const unknown: HeadlessStreamEvent = {
    type: 'run.failed',
    payload: { code: 'MODEL_ERROR', message: 'Unknown tool name: workspace.nope' },
  };

  it('continues the run with a prompt listing the exact tool names', async () => {
    const { runtime, result, events } = await run([[unknown], [COMPLETED]], { autoContinue: 1 });

    expect(runtime.starts).toHaveLength(2);
    expect(runtime.starts[1]?.prompt).toContain('workspace.file (');
    expect(runtime.starts[1]?.prompt).toContain('does not exist');
    expect(result.outcome).toBe('completed');
    expect(events).toContainEqual({ type: 'run.continued', attempt: 1, reason: 'unknown-tool' });
  });

  it('flags the result when no continuation is allowed', async () => {
    const { result } = await run([[unknown]]);

    expect(result.unknownTool).toBe(true);
    expect(result.outcome).toBe('failed');
  });

  it('refuses a made-up tool with the correct list', async () => {
    const { runtime } = await run([[toolCall('nonsense.tool', 'go'), COMPLETED]]);

    expect(JSON.stringify(runtime.submitted[0])).toContain('workspace.file (');
  });
});

describe('tool-name aliases', () => {
  const call = (toolName: string, operation = '') => ({ toolName, operation, arguments: {} });

  it.each([
    ['workspace.file.read', '', 'read'],
    ['workspaces.file.read', '', 'read'],
    ['workspace.file.read', 'read', 'read'],
    ['workspace_file_read', '', 'read'],
  ])('maps %s to workspace.file read', (name, operation, expected) => {
    expect(resolveToolAlias(call(name, operation))).toMatchObject({
      toolName: 'workspace.file',
      operation: expected,
    });
  });

  it('leaves exact, ambiguous and unknown names alone', () => {
    expect(resolveToolAlias(call('workspace.file', 'read')).toolName).toBe('workspace.file');
    expect(resolveToolAlias(call('workspace.file.read', 'create')).toolName).toBe(
      'workspace.file.read',
    );
    expect(resolveToolAlias(call('workspace.file.explode')).toolName).toBe(
      'workspace.file.explode',
    );
    expect(resolveToolAlias(call('mcp.thing.read')).toolName).toBe('mcp.thing.read');
  });

  it('runs an aliased call in a run', async () => {
    const { runtime } = await run([[toolCall('workspaces.file.read', ''), COMPLETED]]);

    expect(JSON.stringify(runtime.submitted[0])).not.toContain('PERMISSION_DENIED');
  });
});

describe('busy provider', () => {
  it('retries an HTTP 400 that says busy, and no other 400', () => {
    expect(classifyFailure(new RuntimeHttpError('/x', 400, 'The provider is busy')).retry).toBe(
      true,
    );
    expect(classifyFailure(new RuntimeHttpError('/x', 400, 'bad payload')).retry).toBe(false);
  });
});

describe('completion check output', () => {
  it('carries the tail of a failing check in run.checks, and none for a pass', async () => {
    const pass: DoneCheck = { label: 'ok', executable: process.execPath, args: ['-e', ''] };
    const { events } = await run([[COMPLETED]], { doneChecks: [failing('gate'), pass] });

    const checks = events.flatMap((event) => (event.type === 'run.checks' ? event.checks : []));
    expect(checks[0]?.tail).toContain('missing-flag-xyz');
    expect(checks[0]?.tail?.length).toBeLessThanOrEqual(600);
    expect(checks[1]?.tail).toBeUndefined();
  });

  it('asks for a different approach when the same failure repeats', async () => {
    const { runtime } = await run([[COMPLETED], [COMPLETED], [COMPLETED]], {
      doneChecks: [failing('gate')],
      autoContinue: 2,
    });

    expect(runtime.starts[1]?.prompt).not.toContain('DIFFERENT approach');
    expect(runtime.starts[2]?.prompt).toContain('DIFFERENT approach');
    expect(runtime.starts[2]?.prompt).toContain('missing-flag-xyz');
  });
});

describe('--list-models', () => {
  it('parses without a prompt', () => {
    expect(parseHeadlessArgs(['--list-models', '--json'], {}, workspace)).toEqual({
      kind: 'list-models',
      request: { backendUrl: undefined, json: true },
    });
  });

  it('prints the account models and starts no run', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              provider: 'OLLAMA',
              modelKey: 'glm-5.2',
              displayName: 'GLM 5.2',
              supportsTools: true,
            },
          ]),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out: string[] = [];

    const code = await runHeadlessCli(
      ['--list-models', '--backend-url', 'https://b.test/api/v1'],
      { CLAW_TOKEN: 'tok' },
      { stdout: (text) => out.push(text), stderr: () => undefined },
      { cwd: workspace },
    );

    expect(code).toBe(0);
    expect(out.join('')).toContain('OLLAMA/glm-5.2\tGLM 5.2\ttools');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://b.test/api/v1/connectors/available-models',
    );
  });

  it('exits 3 when there is no credential', async () => {
    const code = await runHeadlessCli(
      ['--list-models'],
      {},
      { stdout: () => undefined, stderr: () => undefined },
      { cwd: workspace },
    );

    expect(code).toBe(3);
  });
});
