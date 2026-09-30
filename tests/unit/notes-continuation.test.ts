import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { CONTINUATION_PROMPT } from '../../src/sdk/server-budget.constants';
import { COMPLETED, scriptedRuns } from '../helpers/scripted-runs';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentEvent } from '../../src/sdk/create-agent.types';

const created: string[] = [];
let state = '';
let workspace = '';
const saved = process.env.CLAW_STATE_DIR;

beforeEach(() => {
  state = mkdtempSync(path.join(tmpdir(), 'claw-state-'));
  workspace = mkdtempSync(path.join(tmpdir(), 'claw-ws-'));
  created.push(state, workspace);
  process.env.CLAW_STATE_DIR = state;
});

afterEach(() => {
  if (saved === undefined) delete process.env.CLAW_STATE_DIR;
  else process.env.CLAW_STATE_DIR = saved;
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const noteCall = (text: string, tag?: string): HeadlessStreamEvent => ({
  type: 'tool.requested',
  payload: {
    invocationId: `n-${text}`,
    toolName: 'workspace.notes',
    operation: 'add',
    invocation: { arguments: { text, ...(tag === undefined ? {} : { tag }) } },
  },
});

const BUDGET: HeadlessStreamEvent = {
  type: 'run.failed',
  payload: {
    code: 'RUNTIME_BUDGET_EXHAUSTED',
    message: 'The run used all of its allowed tool calls.',
  },
};

describe('notes carried into later prompts', () => {
  it('appends the current notes to the auto-continue prompt and emits note.added without text', async () => {
    const runtime = scriptedRuns([
      [noteCall('routes are in src/app', 'layout'), BUDGET],
      [COMPLETED],
    ]);
    const events: AgentEvent[] = [];
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: runtime.transport,
    });

    const result = await agent.run('build it', {
      autoContinue: 1,
      onEvent: (event) => events.push(event),
    });

    expect(result.outcome).toBe('completed');
    expect(runtime.starts[0]?.prompt).toBe('build it');
    expect(runtime.starts[1]?.prompt).toBe(
      `${CONTINUATION_PROMPT}\n\nYour notes so far:\n1. [layout] routes are in src/app`,
    );
    const added = events.filter((event) => event.type === 'note.added');
    expect(added).toEqual([{ type: 'note.added', id: 1, tag: 'layout', chars: 21 }]);
    expect(JSON.stringify(added)).not.toContain('routes are');
  });

  it('leaves the continuation prompt alone when there are no notes', async () => {
    const runtime = scriptedRuns([[BUDGET], [COMPLETED]]);
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: runtime.transport,
    });

    await agent.run('build it', { autoContinue: 1 });

    expect(runtime.starts[1]?.prompt).toBe(CONTINUATION_PROMPT);
  });

  it('gives a resumed conversation its notes in the very first prompt, once', async () => {
    const first = scriptedRuns([[noteCall('decision: use vitest'), COMPLETED]]);
    const original = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: first.transport,
    });
    await original.run('start');
    const thread = original.threadId;

    const second = scriptedRuns([[COMPLETED], [COMPLETED]]);
    const resumed = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: second.transport,
      threadId: thread,
    });
    await resumed.run('carry on');
    await resumed.run('again');

    expect(second.starts[0]?.prompt).toBe(
      'carry on\n\nYour notes so far:\n1. decision: use vitest',
    );
    expect(second.starts[1]?.prompt).toBe('again');
  });

  it("keeps a resume without notes unchanged and a fresh agent free of another thread's notes", async () => {
    const runtime = scriptedRuns([[COMPLETED]]);
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: runtime.transport,
      threadId: 'thread-with-nothing',
    });

    await agent.run('carry on');

    expect(runtime.starts[0]?.prompt).toBe('carry on');
  });

  it('writes the notes under the state directory and never into the workspace', async () => {
    const runtime = scriptedRuns([[noteCall('kept elsewhere'), COMPLETED]]);
    const agent = createAgent({
      auth: { token: 'test-token-abc' },
      workspaceRoot: workspace,
      transport: runtime.transport,
    });

    await agent.run('go');

    expect(readdirSync(path.join(state, 'notes'))).toHaveLength(1);
    expect(readdirSync(workspace)).toEqual([]);
  });
});
