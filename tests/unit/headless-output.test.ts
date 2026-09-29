import { describe, expect, it } from 'vitest';

import { textLine, writeEvent, writeResult } from '../../src/headless/headless-output';

import type { AgentResult } from '../../src/sdk/create-agent.types';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: { stdout: (text: string) => out.push(text), stderr: (text: string) => err.push(text) },
  };
}

const result: AgentResult = {
  outcome: 'completed',
  exitCode: 0,
  toolCalls: 2,
  deniedCalls: 0,
  text: 'answer',
  runId: 'run-1',
};

describe('writeEvent', () => {
  it('streams answer text to stdout and tool activity to stderr in text mode', () => {
    const { io, out, err } = capture();

    writeEvent('text', { type: 'text', text: 'hi' }, io);
    writeEvent('text', { type: 'tool.call', toolName: 't', operation: 'o', arguments: {} }, io);
    writeEvent('text', { type: 'runtime', name: 'model.started' }, io);

    expect(out).toEqual(['hi']);
    expect(err).toEqual(['[tool] t.o\n']);
  });

  it('writes one JSON line per event in stream-json mode', () => {
    const { io, out } = capture();

    writeEvent('stream-json', { type: 'text', text: 'hi' }, io);

    expect(out).toEqual(['{"type":"text","text":"hi"}\n']);
    expect(JSON.parse(out[0] ?? '')).toEqual({ type: 'text', text: 'hi' });
  });

  it('writes nothing per event in json mode', () => {
    const { io, out, err } = capture();

    writeEvent('json', { type: 'text', text: 'hi' }, io);

    expect([...out, ...err]).toEqual([]);
  });
});

describe('writeResult', () => {
  it('prints one JSON object in json mode', () => {
    const { io, out } = capture();

    writeResult('json', result, io);

    expect(JSON.parse(out.join(''))).toEqual(result);
  });

  it('closes the answer line and reports the outcome to stderr in text mode', () => {
    const { io, out, err } = capture();

    writeResult('text', { ...result, error: 'why' }, io);

    expect(out).toEqual(['\n']);
    expect(err[0]).toContain('2 tool call(s). exit 0');
    expect(err[1]).toBe('why\n');
  });

  it('adds no newline when the answer already ends with one or is empty', () => {
    const { io, out } = capture();

    writeResult('text', { ...result, text: '' }, io);
    writeResult('text', { ...result, text: 'done\n' }, io);

    expect(out).toEqual([]);
  });

  it('prints nothing extra in stream-json mode', () => {
    const { io, out, err } = capture();

    writeResult('stream-json', result, io);

    expect([...out, ...err]).toEqual([]);
  });
});

describe('textLine', () => {
  it('describes denials and failed results, and stays silent for successes', () => {
    expect(textLine({ type: 'tool.denied', toolName: 't', operation: 'o' })).toBe('[denied] t.o\n');
    expect(
      textLine({ type: 'tool.result', toolName: 't', operation: 'o', ok: false, message: 'no' }),
    ).toBe('[tool failed] t.o: no\n');
    expect(textLine({ type: 'tool.result', toolName: 't', operation: 'o', ok: false })).toBe(
      '[tool failed] t.o: \n',
    );
    expect(textLine({ type: 'tool.result', toolName: 't', operation: 'o', ok: true })).toBe(
      undefined,
    );
  });
});
