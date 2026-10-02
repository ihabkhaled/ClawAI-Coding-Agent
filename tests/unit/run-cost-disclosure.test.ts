import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { RunTelemetryRecorder } from '../../src/core/run-telemetry';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

function event(type: string, payload: Record<string, unknown>): RuntimeEvent {
  return { type, payload, timestamp: 't' } as unknown as RuntimeEvent;
}

const finish = (recorder: RunTelemetryRecorder) => recorder.usage('r', 'ok', 'a', 'b');

describe('F108: cost is shown or recorded only when the event carries it', () => {
  it('reads costMicros from a run.usage event', () => {
    const recorder = new RunTelemetryRecorder('r', 's');
    recorder.observe(event('run.usage', { inputTokens: 100, outputTokens: 50, costMicros: 1234 }));
    expect(finish(recorder)).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      costMicros: 1234,
    });
  });

  it('never estimates a cost from tokens: a run.usage without costMicros has none', () => {
    const recorder = new RunTelemetryRecorder('r', 's');
    recorder.observe(event('run.usage', { inputTokens: 1_000_000, outputTokens: 1_000_000 }));
    expect(finish(recorder)).not.toHaveProperty('costMicros');
  });

  it.each([-5, Number.NaN, Number.POSITIVE_INFINITY, '900', null, {}])(
    'ignores the non-cost value %s instead of reporting a free run',
    (value) => {
      const recorder = new RunTelemetryRecorder('r', 's');
      recorder.observe(event('run.usage', { inputTokens: 5, costMicros: value }));
      expect(finish(recorder)).not.toHaveProperty('costMicros');
    },
  );

  it('keeps an explicit zero, which the backend chose to send', () => {
    const recorder = new RunTelemetryRecorder('r', 's');
    recorder.observe(event('run.usage', { costMicros: 0 }));
    expect(finish(recorder).costMicros).toBe(0);
  });

  it('keeps a whole number of micro-dollars, never a float', () => {
    const recorder = new RunTelemetryRecorder('r', 's');
    recorder.observe(event('run.usage', { costMicros: 10.9 }));
    expect(finish(recorder).costMicros).toBe(10);
  });
});

describe('F108: the panel has no way to invent a cost', () => {
  const roots = ['media', path.join('src', 'webview')];
  const files = roots.flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:js|ts)$/u.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name)),
  );

  it('finds the panel sources', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('%s does not compute or format a money amount', (file) => {
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/costMicros|pricePer|perMillion|microUsd|estimatedCost|usdPer/iu);
  });
});
