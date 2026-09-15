import { describe, expect, it } from 'vitest';

import {
  HOOK_EVENTS,
  decideFromHook,
  hooksForEvent,
  lifecycleHookSchema,
} from '../../src/core/lifecycle-hook';

import type { LifecycleHook } from '../../src/core/lifecycle-hook.types';

function hook(overrides: Partial<LifecycleHook> = {}): LifecycleHook {
  return lifecycleHookSchema.parse({ event: 'before-tool', command: 'guard', ...overrides });
}

describe('lifecycleHookSchema', () => {
  it('accepts a minimal hook and defaults the rest', () => {
    expect(hook()).toEqual({
      event: 'before-tool',
      command: 'guard',
      arguments: [],
      blocking: false,
    });
  });

  it('refuses an event nobody emits', () => {
    expect(lifecycleHookSchema.safeParse({ event: 'whenever', command: 'x' }).success).toBe(false);
  });

  it('refuses fields it does not advertise', () => {
    expect(
      lifecycleHookSchema.safeParse({ event: 'run-start', command: 'x', shell: true }).success,
    ).toBe(false);
  });
});

describe('hooksForEvent', () => {
  it('selects only the matching event', () => {
    const hooks = [hook({ event: 'run-start' }), hook({ event: 'run-end' })];

    expect(hooksForEvent(hooks, 'run-start')).toHaveLength(1);
  });

  it('applies to every tool when no glob is given', () => {
    expect(hooksForEvent([hook()], 'before-tool', 'workspace.files')).toHaveLength(1);
  });

  it('narrows by tool glob', () => {
    const hooks = [hook({ toolGlob: 'workspace.*' })];

    expect(hooksForEvent(hooks, 'before-tool', 'workspace.files')).toHaveLength(1);
    expect(hooksForEvent(hooks, 'before-tool', 'runtime.journal')).toHaveLength(0);
  });

  it('does not match a tool-scoped hook when no tool is named', () => {
    expect(hooksForEvent([hook({ toolGlob: 'workspace.*' })], 'before-tool')).toHaveLength(0);
  });

  it('keeps configuration order, which is the order a person wrote', () => {
    const hooks = [hook({ command: 'first' }), hook({ command: 'second' })];

    expect(hooksForEvent(hooks, 'before-tool').map(({ command }) => command)).toEqual([
      'first',
      'second',
    ]);
  });

  it('covers every event it advertises', () => {
    for (const event of HOOK_EVENTS) {
      expect(hooksForEvent([hook({ event })], event)).toHaveLength(1);
    }
  });
});

describe('decideFromHook', () => {
  it('blocks when a blocking pre-tool hook refuses', () => {
    expect(decideFromHook(hook({ blocking: true }), 1, false)).toEqual({
      blocked: true,
      reason: 'refused',
    });
  });

  it('allows when a blocking pre-tool hook passes', () => {
    expect(decideFromHook(hook({ blocking: true }), 0, false)).toEqual({
      blocked: false,
      reason: 'passed',
    });
  });

  it('never blocks on a non-blocking hook, however it exits', () => {
    expect(decideFromHook(hook(), 1, false)).toEqual({
      blocked: false,
      reason: 'advisory-failure',
    });
  });

  it('never blocks after the fact, because there is nothing left to prevent', () => {
    expect(decideFromHook(hook({ event: 'after-tool', blocking: true }), 1, false).blocked).toBe(
      false,
    );
  });

  it('treats a timeout as silence, not refusal', () => {
    expect(decideFromHook(hook({ blocking: true }), undefined, true)).toEqual({
      blocked: false,
      reason: 'timed-out',
    });
  });
});
