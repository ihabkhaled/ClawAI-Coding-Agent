import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach } from 'vitest';

import type { CommandTool } from '../../src/sdk/command-tool.types';

const created: string[] = [];

/** Registers cleanup of every workspace made by `workspace()` after each test. */
export function cleanUpWorkspaces(): void {
  afterEach(() => {
    for (const directory of created.splice(0)) {
      try {
        rmSync(directory, { force: true, recursive: true, maxRetries: 25, retryDelay: 200 });
      } catch {
        // A just-killed process can still hold its working directory on Windows.
        // The folder lives under the OS temp dir, so leaving it is harmless and a
        // cleanup failure must not fail a test that already proved its point.
      }
    }
  });
}

export function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-command-'));
  created.push(directory);
  return directory;
}

export function limits(root: string, extra: readonly string[] = []) {
  return { workspace: root, allowedExecutables: ['node', ...extra] };
}

/** One run call against a tool, in a workspace, with node allowed. */
export function runCommand(
  tool: CommandTool,
  root: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  return Promise.resolve(tool.execute('run', args, limits(root), signal)) as Promise<
    Record<string, unknown>
  >;
}

/** `node -e <script>` as run arguments. */
export function nodeScript(script: string, ...rest: string[]): Record<string, unknown> {
  return { executable: 'node', arguments: ['-e', script, ...rest] };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls until `check` is true or the time is up; returns the last answer. */
export async function eventually(check: () => boolean, withinMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}
