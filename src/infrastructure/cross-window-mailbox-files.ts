import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  MAILBOX_FILE_SUFFIX,
  MAILBOX_TEMP_PREFIX,
  RENAME_BACKOFF_MS,
  RENAME_MAX_ATTEMPTS,
} from '../core/cross-window-mailbox.constants';

const SAFE_KEY = /^[A-Za-z0-9-]{1,64}$/;

/** A window id becomes a directory name, so anything but a plain token is refused. */
export function isSafeKey(key: string): boolean {
  return SAFE_KEY.test(key);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes to a temp file then renames, so a reader never sees half a message.
 * The rename is retried a bounded number of times: Windows refuses it while
 * another process holds the target for an instant.
 */
export async function writeAtomic(dir: string, name: string, body: string): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `${MAILBOX_TEMP_PREFIX}${randomUUID()}`);
  await writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
  for (let attempt = 1; attempt <= RENAME_MAX_ATTEMPTS; attempt += 1) {
    try {
      await rename(temp, join(dir, `${name}${MAILBOX_FILE_SUFFIX}`));
      return true;
    } catch {
      if (attempt < RENAME_MAX_ATTEMPTS) await delay(RENAME_BACKOFF_MS * attempt);
    }
  }
  await rm(temp, { force: true });
  return false;
}

/** Final files only; temp files of a writer still mid-flight are invisible. */
export async function listFinal(dir: string): Promise<readonly string[]> {
  try {
    const names = await readdir(dir);
    return names.filter(
      (name) => name.endsWith(MAILBOX_FILE_SUFFIX) && !name.startsWith(MAILBOX_TEMP_PREFIX),
    );
  } catch {
    return [];
  }
}

export async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function remove(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error: unknown) {
    // A parent that is a file (ENOTDIR on Linux) means there is nothing to remove.
    if ((error as NodeJS.ErrnoException).code !== 'ENOTDIR') throw error;
  }
}
