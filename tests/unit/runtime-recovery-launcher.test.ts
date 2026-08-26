import { setImmediate as settleTasks } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
}));

import { RuntimeRecoveryLauncher } from '../../src/services/runtime-recovery-launcher';

import type { ExtensionState } from '../../src/core/extension-state';
import type { OutputLogger } from '../../src/infrastructure/output-logger';
import type { VscodeRuntimeStudio } from '../../src/services/vscode-runtime-studio';
import type { ChatViewProvider } from '../../src/webview/chat-view-provider';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function launcher(connected: boolean, recover: ReturnType<typeof vi.fn>) {
  const error = vi.fn();
  const instance = new RuntimeRecoveryLauncher(
    { snapshot: { connected } } as ExtensionState,
    { recover } as Pick<VscodeRuntimeStudio, 'recover'> as VscodeRuntimeStudio,
    { error } as Pick<OutputLogger, 'error'> as OutputLogger,
    () => null as ChatViewProvider | null,
  );
  return { error, instance };
}

describe('RuntimeRecoveryLauncher', () => {
  it('skips recovery while disconnected', () => {
    const recover = vi.fn();
    launcher(false, recover).instance.start();
    expect(recover).not.toHaveBeenCalled();
  });

  it('runs one recovery at a time and permits a later retry', async () => {
    const first = deferred<boolean>();
    const recover = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(false);
    const { instance } = launcher(true, recover);
    instance.start();
    instance.start();
    expect(recover).toHaveBeenCalledTimes(1);
    first.resolve(false);
    await first.promise;
    await vi.waitFor(() => {
      expect(recover).toHaveBeenCalledTimes(1);
    });
    await settleTasks();
    instance.start();
    expect(recover).toHaveBeenCalledTimes(2);
  });

  it('logs recovery failure unless disposal aborted it', async () => {
    const failed = deferred<boolean>();
    const active = deferred<boolean>();
    const recover = vi.fn().mockReturnValueOnce(failed.promise).mockReturnValueOnce(active.promise);
    const { error, instance } = launcher(true, recover);
    instance.start();
    failed.reject(new Error('failed'));
    await expect(failed.promise).rejects.toThrow('failed');
    await vi.waitFor(() => {
      expect(error).toHaveBeenCalledOnce();
    });
    instance.start();
    const signal = recover.mock.calls[1]?.[0].signal as AbortSignal;
    instance.dispose();
    expect(signal.aborted).toBe(true);
    active.reject(new Error('aborted'));
    await expect(active.promise).rejects.toThrow('aborted');
    await Promise.resolve();
    expect(error).toHaveBeenCalledOnce();
  });
});
