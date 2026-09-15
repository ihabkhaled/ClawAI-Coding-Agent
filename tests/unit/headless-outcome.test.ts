import { describe, expect, it } from 'vitest';

import {
  describeHeadlessOutcome,
  headlessExitCode,
  outcomeFromTerminalEvent,
} from '../../src/core/headless-outcome';
import { HEADLESS_EXIT_CODES } from '../../src/core/headless-outcome.constants';

import type { HeadlessOutcome } from '../../src/core/headless-outcome.types';

const ALL: readonly HeadlessOutcome[] = [
  'completed',
  'failed',
  'unusable',
  'blocked',
  'cancelled',
  'exhausted',
];

describe('headlessExitCode', () => {
  it('reports success only for a run that reached its end', () => {
    expect(headlessExitCode('completed')).toBe(0);
    for (const outcome of ALL.filter((candidate) => candidate !== 'completed')) {
      expect(headlessExitCode(outcome)).not.toBe(0);
    }
  });

  it('separates a run that never started from one that ran and failed', () => {
    expect(headlessExitCode('unusable')).not.toBe(headlessExitCode('failed'));
  });

  it('gives blocked, cancelled and exhausted their own codes, because each has its own remedy', () => {
    const codes = ['blocked', 'cancelled', 'exhausted'].map((outcome) =>
      headlessExitCode(outcome as HeadlessOutcome),
    );

    expect(new Set(codes).size).toBe(3);
    expect(codes).not.toContain(headlessExitCode('failed'));
  });

  it('promises a distinct code for every outcome', () => {
    const codes = ALL.map((outcome) => headlessExitCode(outcome));

    expect(new Set(codes).size).toBe(ALL.length);
  });

  it('keeps every code inside the range a process can return', () => {
    for (const code of Object.values(HEADLESS_EXIT_CODES)) {
      expect(code).toBeGreaterThanOrEqual(0);
      expect(code).toBeLessThan(126);
    }
  });
});

describe('outcomeFromTerminalEvent', () => {
  it('maps each terminal event to its own outcome', () => {
    expect(outcomeFromTerminalEvent('run.completed')).toBe('completed');
    expect(outcomeFromTerminalEvent('run.cancelled')).toBe('cancelled');
    expect(outcomeFromTerminalEvent('run.blocked')).toBe('blocked');
    expect(outcomeFromTerminalEvent('run.failed')).toBe('failed');
  });

  it('treats a run that ended on nothing as failed, never as success', () => {
    expect(outcomeFromTerminalEvent(undefined)).toBe('failed');
    expect(outcomeFromTerminalEvent('model.delta')).toBe('failed');
    expect(outcomeFromTerminalEvent('')).toBe('failed');
  });
});

describe('describeHeadlessOutcome', () => {
  it('says something specific for every outcome', () => {
    const sentences = ALL.map((outcome) => describeHeadlessOutcome(outcome));

    expect(new Set(sentences).size).toBe(ALL.length);
    for (const sentence of sentences) expect(sentence.length).toBeGreaterThan(20);
  });

  it('tells the reader that a blocked run will block again', () => {
    expect(describeHeadlessOutcome('blocked')).toContain('block again');
  });
});
