import { realpathSync } from 'node:fs';

import { containedPath } from '../core/workspace-containment';

import {
  foldersOfChanges,
  inspectProject,
  listed,
  relativeDir,
  workspaceFolders,
} from './code-gates-detect';
import { changedFiles } from './code-gates-scope';

import type { GateProject } from './code-gates.types';
import type { ToolLimits } from '../headless/headless-main.types';

/** A project as the model sees it: what it is, and the command behind each gate. */
function shown(project: GateProject): Record<string, unknown> {
  return {
    dir: project.dir,
    ecosystem: project.ecosystem,
    ...(project.packageManager === undefined ? {} : { packageManager: project.packageManager }),
    tools: project.tools,
    gates: Object.fromEntries(
      Object.entries(project.gates).map(([name, command]) => [name, command.display]),
    ),
  };
}

function changedSummary(root: string): Record<string, unknown> {
  const changed = changedFiles(root);
  if (changed.problem !== undefined) return { problem: changed.problem };
  const folders = foldersOfChanges(root, changed.files).map((folder) => {
    const project = inspectProject(root, folder.dir);
    return {
      dir: folder.dir,
      files: folder.files,
      gates: project === undefined ? [] : Object.keys(project.gates),
    };
  });
  const { shown: visible, more } = listed(folders);
  return {
    files: changed.files.length,
    folders: visible,
    ...(more > 0 ? { moreFolders: more } : {}),
  };
}

/**
 * `code.gates detect`: the project at the workspace root or at `scope`, the
 * monorepo's workspace folders, and which folders the changed files belong to.
 */
export function detectProjects(
  args: Readonly<Record<string, unknown>>,
  limits: ToolLimits,
): unknown {
  const root = realpathSync(limits.workspace);
  const { scope } = args;
  if (typeof scope === 'string' && scope.length > 0 && scope !== 'changed') {
    const dir = relativeDir(root, containedPath(root, scope));
    const project = inspectProject(root, dir);
    return project === undefined
      ? { projects: [], note: `no project manifest in ${dir}` }
      : { projects: [shown(project)] };
  }
  const workspaces = workspaceFolders(root);
  const folders = listed(workspaces?.dirs ?? []);
  const rootProject = inspectProject(root, '.');
  return {
    projects: rootProject === undefined ? [] : [shown(rootProject)],
    ...(workspaces === undefined
      ? {}
      : { workspaces: { kind: workspaces.kind, dirs: folders.shown, more: folders.more } }),
    changed: changedSummary(root),
    rule: 'run gates in the touched folder only, never all-workspace',
  };
}
