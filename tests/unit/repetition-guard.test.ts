import { describe, expect, it } from 'vitest';

import { createRepetitionGuard } from '../../src/sdk/repetition-guard';

import type { AgentToolCall, AgentToolkit } from '../../src/sdk/agent-sdk.types';
import type { StuckInfo } from '../../src/sdk/repetition-guard.types';

const call = (
  toolName: string,
  operation: string,
  args: Record<string, unknown> = {},
): AgentToolCall => ({ toolName, operation, arguments: args });
const read = (path: string): AgentToolCall => call('workspace.file', 'read', { path });
const write = (path: string): AgentToolCall =>
  call('workspace.file', 'update', { path, oldText: 'a', newText: 'b' });

interface Harness {
  readonly toolkit: AgentToolkit;
  readonly executed: AgentToolCall[];
  readonly stuck: StuckInfo[];
  readonly guard: ReturnType<typeof createRepetitionGuard>;
}

function harness(content = 'line one\nline two'): Harness {
  const executed: AgentToolCall[] = [];
  const stuck: StuckInfo[] = [];
  const inner: AgentToolkit = {
    definitions: [],
    execute: (next) => {
      executed.push(next);
      if (next.arguments.fail === true) throw new Error('boom');
      return { ok: true, content };
    },
  };
  const guard = createRepetitionGuard({ onStuck: (info) => stuck.push(info) });
  return { toolkit: guard.guard(inner), executed, stuck, guard };
}

const record = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

async function times(h: Harness, next: AgentToolCall, count: number): Promise<unknown[]> {
  const results: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    results.push(await h.toolkit.execute(next));
  }
  return results;
}

describe('repetition guard: repeats', () => {
  it('runs the first and second identical call and refuses the third', async () => {
    const h = harness();
    const results = await times(h, read('a.txt'), 3);

    expect(h.executed).toHaveLength(2);
    expect(record(results[1]).repeatedCall).toBeUndefined();
    expect(results[2]).toMatchObject({
      repeatedCall: true,
      times: 3,
      note: 'You have made this exact call 3 times and nothing changed. The result is the same as before. Do not repeat it. Write what you learned to workspace.notes if useful, then take the NEXT step: create or update a file, run a command, or finish.',
      previousResult: 'line one\nline two',
    });
  });

  it('treats argument order as irrelevant and different arguments as different', async () => {
    const h = harness();
    await h.toolkit.execute(call('workspace.file', 'search', { query: 'x', path: 'src' }));
    await h.toolkit.execute(call('workspace.file', 'search', { path: 'src', query: 'x' }));
    const third = await h.toolkit.execute(
      call('workspace.file', 'search', { query: 'x', path: 'src' }),
    );
    const other = await h.toolkit.execute(call('workspace.file', 'search', { query: 'y' }));

    expect(record(third).repeatedCall).toBe(true);
    expect(record(other).repeatedCall).toBeUndefined();
  });

  it('escalates the note at the fifth call, and not before', async () => {
    const results = await times(harness(), read('a.txt'), 5);

    expect(String(record(results[3]).note)).not.toContain('STOP reading');
    expect(record(results[4])).toMatchObject({ repeatedCall: true, times: 5 });
    expect(String(record(results[4]).note)).toContain(
      'STOP reading. You must now write code or end the run with your report.',
    );
  });

  it('ends the run as stuck at the eighth call, once', async () => {
    const h = harness();
    await times(h, read('a.txt'), 7);
    expect(h.stuck).toEqual([]);
    expect(h.guard.stuck()).toBeUndefined();

    await times(h, read('a.txt'), 2);

    expect(h.stuck).toEqual([
      { tool: 'workspace.file', operation: 'read', times: 8, target: 'a.txt' },
    ]);
    expect(h.guard.stuck()).toEqual(h.stuck[0]);
    expect(h.executed).toHaveLength(2);
  });

  it('counts a call still inside the window of forty', async () => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    for (let index = 0; index < 38; index += 1) await h.toolkit.execute(read(`f${String(index)}`));

    expect(record(await h.toolkit.execute(read('a.txt'))).repeatedCall).toBe(true);
  });

  it('forgets a call that fell out of the window of forty', async () => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    for (let index = 0; index < 40; index += 1) await h.toolkit.execute(read(`f${String(index)}`));

    expect(record(await h.toolkit.execute(read('a.txt'))).repeatedCall).toBeUndefined();
  });

  it('caps the previous result to 40 lines and 4000 characters', async () => {
    const lines = Array.from({ length: 200 }, (_, index) => `line ${String(index)}`).join('\n');
    const many = await times(harness(lines), read('big.txt'), 3);
    expect(String(record(many[2]).previousResult).split('\n')).toHaveLength(40);

    const wide = await times(harness('x'.repeat(20_000)), read('wide.txt'), 3);
    expect(String(record(wide[2]).previousResult)).toHaveLength(4_000);
  });

  it('gives no preview for a call that is not a read', async () => {
    const results = await times(harness(), call('workspace.notes', 'add', { text: 'x' }), 3);

    expect(record(results[2]).repeatedCall).toBe(true);
    expect(record(results[2]).previousResult).toBeUndefined();
  });
});

describe('repetition guard: what counts as a change', () => {
  it('resets after a successful write, so the same read runs again', async () => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    await h.toolkit.execute(write('a.txt'));
    const results = await times(h, read('a.txt'), 3);

    expect(record(results[0]).repeatedCall).toBeUndefined();
    expect(record(results[1]).repeatedCall).toBeUndefined();
    expect(record(results[2]).repeatedCall).toBe(true);
  });

  it('does not reset after a write that failed', async () => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    await expect(
      h.toolkit.execute(call('workspace.file', 'update', { path: 'a.txt', fail: true })),
    ).rejects.toThrow('boom');

    expect(record(await h.toolkit.execute(read('a.txt'))).repeatedCall).toBe(true);
  });

  it.each([
    ['a command', call('workspace.command', 'run', { command: 'npm', fail: true })],
    ['a git write', call('workspace.git', 'commit', { message: 'x', fail: true })],
  ])('resets after %s, even a failing one', async (_name, change) => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    await Promise.resolve(h.toolkit.execute(change)).catch(() => undefined);

    expect(record(await h.toolkit.execute(read('a.txt'))).repeatedCall).toBeUndefined();
  });

  it('does not treat a read, a note or a git read as a change', async () => {
    const h = harness();
    await times(h, read('a.txt'), 2);
    await h.toolkit.execute(call('workspace.notes', 'add', { text: 'n' }));
    await h.toolkit.execute(call('workspace.git', 'status'));
    await h.toolkit.execute(read('other.txt'));

    expect(record(await h.toolkit.execute(read('a.txt'))).repeatedCall).toBe(true);
  });

  it('never flags distinct calls', async () => {
    const h = harness();
    for (let index = 0; index < 60; index += 1) {
      const result = await h.toolkit.execute(read(`file-${String(index)}.txt`));
      expect(record(result).repeatedCall).toBeUndefined();
    }
    expect(h.executed).toHaveLength(60);
  });
});

describe('repetition guard: read starvation', () => {
  const noteOf = (value: unknown): unknown => record(value).readingTooLong;

  it('adds a note on the 40th read and every 10th after, and still runs the call', async () => {
    const h = harness();
    const notes: unknown[] = [];
    for (let index = 1; index <= 60; index += 1) {
      notes.push(noteOf(await h.toolkit.execute(read(`f${String(index)}`))));
    }

    expect(notes.slice(0, 39).every((note) => note === undefined)).toBe(true);
    expect(notes[39]).toBe(
      'You have made 40 read-only calls without changing anything. Decide, note your plan with workspace.notes add, and start implementing.',
    );
    expect(notes[44]).toBeUndefined();
    expect(String(notes[49])).toContain('50 read-only calls');
    expect(String(notes[59])).toContain('60 read-only calls');
    expect(h.executed).toHaveLength(60);
  });

  it('starts over after a write or a note', async () => {
    const h = harness();
    for (let index = 1; index <= 39; index += 1) await h.toolkit.execute(read(`f${String(index)}`));
    await h.toolkit.execute(call('workspace.notes', 'add', { text: 'plan' }));

    expect(noteOf(await h.toolkit.execute(read('f40')))).toBeUndefined();
  });

  it('wraps a text result instead of dropping the note', async () => {
    const guard = createRepetitionGuard({ onStuck: () => undefined });
    const toolkit = guard.guard({ definitions: [], execute: () => 'plain text' });
    let last: unknown;
    for (let index = 0; index < 40; index += 1) {
      last = await toolkit.execute(call('workspace.notes', 'read', { n: index }));
    }

    expect(last).toMatchObject({ result: 'plain text' });
    expect(record(last).readingTooLong).toBeDefined();
  });
});
