import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createCommandTool } from '../../src/sdk/command-tool';
import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';
import { createWriteScope } from '../../src/sdk/write-scope';
import { scopeCommandTool } from '../../src/sdk/write-scope-audit';

import {
  cleanUpRepositories as removeRepositories,
  git,
  makeRepository,
} from './sdk-git-tools.helpers';

import type { CommandTool } from '../../src/sdk/command-tool.types';
import type { WriteScope, WriteScopeViolation } from '../../src/sdk/write-scope.types';

export { git } from './sdk-git-tools.helpers';

const toolsByScope = new Map<WriteScope | undefined, CommandTool>();

/** Stops every background process a test started, then removes its repositories. */
export function cleanUpRepositories(): void {
  for (const tool of toolsByScope.values()) tool.dispose();
  toolsByScope.clear();
  removeRepositories();
}

/** One command tool per scope, so a background process is still there for the next call. */
function commandsFor(scope: WriteScope | undefined): CommandTool {
  const known = toolsByScope.get(scope);
  if (known !== undefined) return known;
  const made =
    scope === undefined ? createCommandTool() : scopeCommandTool(createCommandTool(), scope);
  toolsByScope.set(scope, made);
  return made;
}

/** A scope over `scope` and `deny`, recording what it stops in `seen`. */
export function scopeOf(
  scope: string[],
  deny: string[] = [],
  seen: WriteScopeViolation[] = [],
): WriteScope {
  const created = createWriteScope({ scope, deny }, { onViolation: (item) => seen.push(item) });
  if (created === undefined) throw new Error('the scope was empty');
  return created;
}

/** Writes a file below `root`, making its folders. */
export function put(root: string, name: string, content = 'x\n'): void {
  const target = path.join(root, name);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

/** A repository with `src/a.ts`, `docs/d.md` and `other.txt` committed, and `ignored/` in `.gitignore`. */
export function scopedRepository(): string {
  const repository = makeRepository();
  put(repository, '.gitignore', 'ignored/\n*.log\n');
  put(repository, 'src/a.ts', 'a\n');
  put(repository, 'docs/d.md', 'd\n');
  put(repository, 'other.txt', 'o\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '--quiet', '-m', 'files');
  return repository;
}

/** One tool call, the way the toolkit runs it, under `scope`. */
export async function call(
  workspace: string,
  scope: WriteScope | undefined,
  toolName: string,
  operation: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result: unknown = await executeWorkspaceTool(
    { toolName, operation, arguments: args },
    { workspace, allowedExecutables: ['node', 'git', 'rm', 'sed'], writeScope: scope },
    undefined,
    commandsFor(scope),
  );
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error(`${toolName} did not return an object`);
  }
  return Object.fromEntries(Object.entries(result));
}

/** `node -e <script>` as `workspace.command run` arguments. */
export function nodeRun(
  script: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { executable: 'node', arguments: ['-e', script], ...extra };
}
