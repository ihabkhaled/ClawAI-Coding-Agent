import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { nodeProject, readPackageJson } from './code-gates-detect-node';
import { goProject, pythonProject, rustProject } from './code-gates-detect-other';
import { GATE_MAX_LISTED_DIRS } from './code-gates.constants';

import type { GateProject, GateWorkspaces } from './code-gates.types';

const MANIFESTS: readonly string[] = [
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'pytest.ini',
  'setup.cfg',
];

/** A path as it is shown to the model: relative to the workspace, `/` separated. */
export function relativeDir(workspace: string, absolute: string): string {
  const relative = path.relative(workspace, absolute).split(path.sep).join('/');
  return relative.length === 0 ? '.' : relative;
}

/** What is known about the project in one folder, or undefined when it holds none. */
export function inspectProject(workspace: string, relative: string): GateProject | undefined {
  const dir = path.resolve(workspace, relative);
  return (
    nodeProject(workspace, dir, relative) ??
    rustProject(dir, relative) ??
    goProject(dir, relative) ??
    pythonProject(dir, relative)
  );
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function expandPattern(workspace: string, pattern: string): readonly string[] {
  const clean = pattern.replace(/\/+$/u, '');
  if (clean.startsWith('!') || clean.startsWith('..')) return [];
  if (!clean.includes('*')) return isDirectory(path.join(workspace, clean)) ? [clean] : [];
  const star = clean.indexOf('*');
  const base = clean.slice(0, star).replace(/\/$/u, '');
  if (clean.slice(star) !== '*' && clean.slice(star) !== '**') return [];
  try {
    return readdirSync(path.join(workspace, base), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
      .map((entry) => (base.length === 0 ? entry.name : `${base}/${entry.name}`));
  } catch {
    return [];
  }
}

function patternsOf(workspace: string): { kind: string; patterns: readonly string[] } | undefined {
  const pkg = readPackageJson(path.join(workspace, 'package.json'));
  const declared = pkg?.workspaces;
  const list = Array.isArray(declared)
    ? declared
    : typeof declared === 'object' && declared !== null && 'packages' in declared
      ? (declared as { packages?: unknown }).packages
      : undefined;
  if (Array.isArray(list)) {
    return {
      kind: 'npm workspaces',
      patterns: list.filter((x): x is string => typeof x === 'string'),
    };
  }
  const pnpm = path.join(workspace, 'pnpm-workspace.yaml');
  if (!existsSync(pnpm)) return undefined;
  const lines = readFileSync(pnpm, 'utf8').split(/\r?\n/u);
  const patterns = lines
    .map((line) => /^\s*-\s*['"]?([^'"#\s]+)['"]?/u.exec(line)?.[1])
    .filter((value): value is string => value !== undefined);
  return { kind: 'pnpm workspaces', patterns };
}

/** The workspace folders the root manifest declares, each one a project of its own. */
export function workspaceFolders(workspace: string): GateWorkspaces | undefined {
  const found = patternsOf(workspace);
  if (found === undefined) return undefined;
  const dirs = found.patterns
    .flatMap((pattern) => expandPattern(workspace, pattern))
    .filter((dir) => MANIFESTS.some((name) => existsSync(path.join(workspace, dir, name))));
  return { kind: found.kind, dirs: [...new Set(dirs)].sort() };
}

/** The nearest folder at or above `file` (inside the workspace) that holds a manifest. */
export function projectDirOf(workspace: string, file: string): string | undefined {
  let current = path.dirname(path.resolve(workspace, file));
  for (;;) {
    if (MANIFESTS.some((name) => existsSync(path.join(current, name)))) {
      return relativeDir(workspace, current);
    }
    const parent = path.dirname(current);
    if (current === workspace || parent === current) return undefined;
    current = parent;
  }
}

/** Folders that hold changed files, with how many each, most changed first. */
export function foldersOfChanges(
  workspace: string,
  files: readonly string[],
): readonly { dir: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const dir = projectDirOf(workspace, file) ?? '.';
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([dir, count]) => ({ dir, files: count }))
    .sort((a, b) => b.files - a.files || a.dir.localeCompare(b.dir));
}

/** How many entries of a list detection prints before it says how many more there are. */
export function listed<T>(values: readonly T[]): { shown: readonly T[]; more: number } {
  return {
    shown: values.slice(0, GATE_MAX_LISTED_DIRS),
    more: Math.max(0, values.length - GATE_MAX_LISTED_DIRS),
  };
}
