import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FileHandle } from 'node:fs/promises';

const LOCK_POLL_MS = 25;
const STALE_LOCK_MS = 10 * 60 * 1_000;

interface LockOwner {
  createdAt: number;
  nonce: string;
  pid: number;
}

interface AcquiredLock {
  handle: FileHandle;
  owner: LockOwner;
  path: string;
}

export interface SessionLockPort {
  run<T>(scope: string, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T>;
}

function lockPath(scope: string): string {
  const digest = createHash('sha256').update(scope, 'utf8').digest('hex');
  return join(tmpdir(), 'clawai-vscode-session-locks', `${digest}.lock`);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function isLockContention(error: unknown): boolean {
  return (
    isNodeError(error, 'EEXIST') || isNodeError(error, 'EACCES') || isNodeError(error, 'EPERM')
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !isNodeError(error, 'ESRCH');
  }
}

async function waitForRetry(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const complete = (): void => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(complete, LOCK_POLL_MS);
    const abort = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new Error('Session operation was cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => {
      if (signal?.aborted === true) {
        abort();
      }
    });
  });
}

export class FileSessionLock implements SessionLockPort {
  async run<T>(
    scope: string,
    signal: AbortSignal | undefined,
    action: () => Promise<T>,
  ): Promise<T> {
    const acquired = await this.acquire(scope, signal);
    try {
      return await action();
    } finally {
      await this.release(acquired);
    }
  }

  private async acquire(scope: string, signal?: AbortSignal): Promise<AcquiredLock> {
    const path = lockPath(scope);
    await mkdir(join(tmpdir(), 'clawai-vscode-session-locks'), { recursive: true });
    for (;;) {
      signal?.throwIfAborted();
      try {
        const handle = await open(path, 'wx', 0o600);
        const owner = {
          createdAt: Date.now(),
          nonce: randomUUID(),
          pid: process.pid,
        };
        await handle.writeFile(JSON.stringify(owner), 'utf8');
        return { handle, owner, path };
      } catch (error: unknown) {
        // Windows can report a sharing violation for an existing open lock as
        // EACCES/EPERM instead of the POSIX EEXIST result.
        if (!isLockContention(error)) {
          throw error;
        }
        if (await this.isStale(path)) {
          await unlink(path).catch((unlinkError: unknown) => {
            if (!isNodeError(unlinkError, 'ENOENT')) {
              throw unlinkError;
            }
          });
          continue;
        }
        await waitForRetry(signal);
      }
    }
  }

  private async isStale(path: string): Promise<boolean> {
    try {
      const metadata = await stat(path);
      if (Date.now() - metadata.mtimeMs > STALE_LOCK_MS) {
        return true;
      }
      const value: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (
        typeof value !== 'object' ||
        value === null ||
        !('pid' in value) ||
        typeof value.pid !== 'number'
      ) {
        return false;
      }
      return !processIsAlive(value.pid);
    } catch {
      // Another owner may have released the lock between our failed exclusive
      // open and this inspection. Treat a vanished path as a normal retry;
      // deleting it here can unlink a replacement lock acquired in that gap.
      return false;
    }
  }

  private async release(acquired: AcquiredLock): Promise<void> {
    await acquired.handle.close();
    try {
      const current: unknown = JSON.parse(await readFile(acquired.path, 'utf8'));
      if (
        typeof current === 'object' &&
        current !== null &&
        'nonce' in current &&
        current.nonce === acquired.owner.nonce
      ) {
        await unlink(acquired.path);
      }
    } catch (error: unknown) {
      if (!isNodeError(error, 'ENOENT')) {
        throw error;
      }
    }
  }
}
