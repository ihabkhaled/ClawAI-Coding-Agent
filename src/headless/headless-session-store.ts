import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AGENT_THREAD_ID_PATTERN } from '../sdk/agent-inputs.constants';

import {
  HEADLESS_SESSION_FILE,
  HEADLESS_SESSION_MAX_ENTRIES,
  HEADLESS_STATE_DIR_ENV,
  HEADLESS_STATE_DIR_NAME,
} from './headless-session-store.constants';

import type { HeadlessEnvironment } from './headless-args.types';
import type {
  HeadlessSessionEntry,
  HeadlessSessionScope,
  HeadlessSessionStore,
} from './headless-session-store.types';

/** Where the CLI keeps its state: `CLAW_STATE_DIR`, else `~/.clawai`. */
export function headlessStateDirectory(environment: HeadlessEnvironment): string {
  return environment[HEADLESS_STATE_DIR_ENV] ?? path.join(os.homedir(), HEADLESS_STATE_DIR_NAME);
}

/** The scope's key: a hash, so the file never spells out a workspace path. */
export function sessionKey(scope: HeadlessSessionScope): string {
  return createHash('sha256')
    .update(`${scope.backendUrl}\n${scope.workspace}`)
    .digest('hex')
    .slice(0, 32);
}

function isEntry(value: unknown): value is HeadlessSessionEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { threadId, updatedAt } = value as Record<string, unknown>;
  return (
    typeof threadId === 'string' &&
    AGENT_THREAD_ID_PATTERN.test(threadId) &&
    typeof updatedAt === 'string'
  );
}

async function readEntries(file: string): Promise<Record<string, HeadlessSessionEntry>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => isEntry(entry)));
  } catch {
    // Missing or corrupt state is "no previous run", never a reason to fail one.
    return {};
  }
}

/**
 * A JSON file of scope hash to thread id, written atomically with owner-only
 * permissions. A write that fails is ignored: losing `--continue` for one run
 * is better than failing a run that already finished.
 */
export function fileSessionStore(environment: HeadlessEnvironment): HeadlessSessionStore {
  const directory = headlessStateDirectory(environment);
  const file = path.join(directory, HEADLESS_SESSION_FILE);
  return {
    latest: async (scope) => (await readEntries(file))[sessionKey(scope)]?.threadId,
    remember: async (scope, threadId) => {
      try {
        const entries = await readEntries(file);
        entries[sessionKey(scope)] = { threadId, updatedAt: new Date().toISOString() };
        const newest = Object.entries(entries)
          .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
          .slice(0, HEADLESS_SESSION_MAX_ENTRIES);
        await mkdir(directory, { recursive: true });
        const temporary = `${file}.${String(process.pid)}.tmp`;
        await writeFile(temporary, JSON.stringify(Object.fromEntries(newest)), { mode: 0o600 });
        await rename(temporary, file);
      } catch {
        // See above.
      }
    },
  };
}
