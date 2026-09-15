import { describe, expect, it, vi } from 'vitest';

import { lifecycleHookSchema } from '../../src/core/lifecycle-hook';
import { LifecycleHookService } from '../../src/services/lifecycle-hook-service';

import type { LifecycleHook } from '../../src/core/lifecycle-hook.types';
import type { HookRunResult } from '../../src/services/lifecycle-hook.types';

function hook(overrides: Partial<LifecycleHook> = {}): LifecycleHook {
  return lifecycleHookSchema.parse({ event: 'before-tool', command: 'guard', ...overrides });
}

function service(
  hooks: LifecycleHook[],
  result: HookRunResult | (() => Promise<HookRunResult>) = { exitCode: 0, timedOut: false },
  trusted = true,
) {
  const run = vi.fn(async () => (typeof result === 'function' ? result() : result));
  const log = vi.fn();
  return {
    run,
    log,
    subject: new LifecycleHookService({
      runner: { run },
      hooks: () => hooks,
      trusted: () => trusted,
      log,
    }),
  };
}

describe('LifecycleHookService', () => {
  it('runs nothing in an untrusted workspace', async () => {
    const { subject, run } = service([hook()], { exitCode: 0, timedOut: false }, false);

    await expect(subject.run('before-tool', 'workspace.files')).resolves.toMatchObject({
      blocked: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a matching hook', async () => {
    const { subject, run } = service([hook()]);

    await subject.run('before-tool', 'workspace.files');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blocks the call when a blocking hook refuses', async () => {
    const { subject } = service([hook({ blocking: true })], { exitCode: 1, timedOut: false });

    await expect(subject.run('before-tool', 'workspace.files')).resolves.toEqual({
      blocked: true,
      reason: 'refused',
    });
  });

  it('stops at the first refusal rather than running the rest', async () => {
    const { subject, run } = service(
      [hook({ blocking: true, command: 'first' }), hook({ blocking: true, command: 'second' })],
      { exitCode: 1, timedOut: false },
    );

    await subject.run('before-tool', 'workspace.files');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('lets a failing advisory hook through', async () => {
    const { subject } = service([hook()], { exitCode: 1, timedOut: false });

    await expect(subject.run('before-tool', 'workspace.files')).resolves.toMatchObject({
      blocked: false,
      reason: 'advisory-failure',
    });
  });

  it('lets a hung hook through rather than halting every run', async () => {
    const { subject } = service([hook({ blocking: true })], {
      exitCode: undefined,
      timedOut: true,
    });

    await expect(subject.run('before-tool', 'workspace.files')).resolves.toEqual({
      blocked: false,
      reason: 'timed-out',
    });
  });

  it('reports a hook that could not start, and does not refuse the call', async () => {
    const { subject, log } = service([hook({ blocking: true })], async () => {
      throw new Error('ENOENT');
    });

    await expect(subject.run('before-tool', 'workspace.files')).resolves.toMatchObject({
      blocked: false,
    });
    expect(log).toHaveBeenCalled();
  });

  it('ignores hooks attached to another event', async () => {
    const { subject, run } = service([hook({ event: 'run-end' })]);

    await subject.run('run-start');

    expect(run).not.toHaveBeenCalled();
  });
});
