import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isInside } from './notes-store';
import { isPlanStep } from './task-plan-steps';
import { PLAN_DIRECTORY_NAME, PLAN_MAX_BYTES, PLAN_NO_THREAD } from './task-plan-tool.constants';

import type { NotesStoreOptions } from './notes-tool.types';
import type { PlanStep, PlanStore } from './task-plan-tool.types';

/** The file for one conversation: a hash, so the name never spells a path or a thread. */
export function planFileFor(
  stateDirectory: string,
  workspace: string,
  threadId: string | undefined,
): string {
  const key = createHash('sha256')
    .update(`plan\n${path.resolve(workspace)}\n${threadId ?? PLAN_NO_THREAD}`)
    .digest('hex')
    .slice(0, 32);
  return path.join(stateDirectory, PLAN_DIRECTORY_NAME, `${key}.json`);
}

/** Whatever the file holds; a missing or corrupt file is no plan at all. */
function readSteps(file: string): readonly PlanStep[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return [];
    const { steps } = parsed as Record<string, unknown>;
    return Array.isArray(steps) && steps.every(isPlanStep) ? steps : [];
  } catch {
    return [];
  }
}

function writeSteps(file: string, steps: readonly PlanStep[]): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = `${file}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, steps }), { mode: 0o600 });
    renameSync(temporary, file);
  } catch {
    // The plan stays in memory: losing it across a restart beats failing a tool call.
  }
}

/** The file to persist to, or undefined when there is none or it would land in the workspace. */
function persistentFile(options: NotesStoreOptions, key: string): string | undefined {
  if (options.stateDirectory === undefined) return undefined;
  const thread = key === PLAN_NO_THREAD ? undefined : key;
  const file = planFileFor(options.stateDirectory, options.workspace, thread);
  return isInside(options.workspace, file) ? undefined : file;
}

/**
 * The plan of one conversation: kept in memory, and written through to a file
 * under the state directory next to the notes, never inside the workspace.
 *
 * The conversation is looked up on every call, because the thread id only
 * exists once the first run has started. A plan made before that (the
 * orchestrator's preloaded one) moves to the thread's own file when it appears.
 */
export function createPlanStore(options: NotesStoreOptions): PlanStore {
  const loaded: { key: string; file: string | undefined; steps: readonly PlanStep[] } = {
    key: '',
    file: undefined,
    steps: [],
  };
  const current = (): readonly PlanStep[] => {
    const key = options.threadId() ?? PLAN_NO_THREAD;
    if (loaded.key === key) return loaded.steps;
    const carried = loaded.key === PLAN_NO_THREAD ? loaded.steps : [];
    const file = persistentFile(options, key);
    const stored = file === undefined ? [] : readSteps(file);
    loaded.key = key;
    loaded.file = file;
    loaded.steps = stored.length === 0 ? carried : stored;
    if (loaded.steps === carried && carried.length > 0 && file !== undefined) {
      writeSteps(file, carried);
    }
    return loaded.steps;
  };
  return {
    list: current,
    save: (steps) => {
      current();
      if (JSON.stringify(steps).length > PLAN_MAX_BYTES) {
        throw new Error(
          `The plan is too big (${String(PLAN_MAX_BYTES / 1024)} KB). Shorten the titles.`,
        );
      }
      loaded.steps = steps;
      if (loaded.file !== undefined) writeSteps(loaded.file, steps);
    },
    clear: () => {
      if (current().length === 0) return;
      loaded.steps = [];
      if (loaded.file !== undefined) writeSteps(loaded.file, []);
    },
  };
}
