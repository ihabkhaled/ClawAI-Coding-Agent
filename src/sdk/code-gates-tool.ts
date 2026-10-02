import { realpathSync } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import {
  foldersOfChanges,
  inspectProject,
  projectDirOf,
  relativeDir,
  workspaceFolders,
} from './code-gates-detect';
import { detectProjects } from './code-gates-detect-report';
import { gateFolder } from './code-gates-done-checks';
import { runGate, unavailableResult } from './code-gates-run';
import { changedFiles } from './code-gates-scope';
import {
  GATE_DEFAULT_TIMEOUT_MS,
  GATE_MAX_CHANGED_PROJECTS,
  GATE_MAX_FILES,
  GATE_MAX_TIMEOUT_MS,
  GATE_NAMES,
  GATE_REPORT_MAX,
} from './code-gates.constants';
import { systemCommandRuntime } from './command-tool';
import { clampedInteger } from './command-tool-request';

import type { GateName, GateResult } from './code-gates.types';
import type { CommandRuntime } from './command-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';

type ToolArguments = Readonly<Record<string, unknown>>;

/** What the workspace toolkit holds for `code.gates`. */
export interface GatesTool {
  /** Throws on a refused call; otherwise returns the result, or a promise of it. */
  readonly execute: (
    operation: string,
    args: ToolArguments,
    limits: ToolLimits,
    signal?: AbortSignal,
  ) => unknown;
}

interface Target {
  readonly dir: string;
  readonly files: readonly string[];
}

interface Recorded {
  readonly result: GateResult;
  readonly at: number;
}

function requireGate(value: unknown): GateName {
  const found = GATE_NAMES.find((name) => name === value);
  if (found === undefined) {
    throw new Error(`code.gates run needs "gate": one of ${GATE_NAMES.join(', ')}.`);
  }
  return found;
}

/** Workspace-relative files: strings, bounded, never a flag, always inside the workspace. */
function requestedFiles(value: unknown, root: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > GATE_MAX_FILES) {
    throw new Error(`"files" is an array of at most ${String(GATE_MAX_FILES)} paths.`);
  }
  return value.map((entry: unknown) => {
    if (typeof entry !== 'string' || entry.length === 0 || entry.startsWith('-')) {
      throw new Error('Every file is a path string that does not start with "-".');
    }
    return relativeDir(root, containedPath(root, entry));
  });
}

function sameFolder(root: string, files: readonly string[]): string {
  const folders = new Set(files.map((file) => projectDirOf(root, file) ?? '.'));
  if (folders.size > 1) {
    throw new Error(
      `"files" span several folders (${[...folders].join(', ')}); run once per folder.`,
    );
  }
  return [...folders][0] ?? '.';
}

function rootTarget(root: string): string {
  const dirs = workspaceFolders(root)?.dirs ?? [];
  if (dirs.length > 1) {
    throw new Error(
      `The workspace root is a monorepo: run gates in the touched folder, not over everything. Pass "scope": "changed" or a folder such as ${dirs.slice(0, 5).join(', ')}; "." runs the root gate over all of it.`,
    );
  }
  const folder = gateFolder(root);
  if (folder !== undefined) return folder;
  throw new Error(
    `The workspace root is not a project. Pass "scope": a folder${
      dirs.length > 0 ? ` such as ${dirs.slice(0, 5).join(', ')}` : ''
    }, or "changed".`,
  );
}

function targetsOf(args: ToolArguments, root: string): readonly Target[] {
  const files = requestedFiles(args.files, root);
  const { scope } = args;
  if (scope === 'changed') {
    const changed = changedFiles(root);
    if (changed.problem !== undefined) throw new Error(`scope "changed": ${changed.problem}.`);
    const folders = foldersOfChanges(root, changed.files).slice(0, GATE_MAX_CHANGED_PROJECTS);
    if (folders.length === 0) throw new Error('scope "changed": no files have changed.');
    return folders.map((folder) => ({ dir: folder.dir, files: [] }));
  }
  if (typeof scope === 'string' && scope.length > 0) {
    return [{ dir: relativeDir(root, containedPath(root, scope)), files }];
  }
  if (scope !== undefined) throw new Error('"scope" is a folder path or "changed".');
  return [{ dir: files.length > 0 ? sameFolder(root, files) : rootTarget(root), files }];
}

function projectFiles(root: string, dir: string, files: readonly string[]): readonly string[] {
  const base = path.resolve(root, dir);
  return files.map((file) => {
    const relative = path.relative(base, path.resolve(root, file)).split(path.sep).join('/');
    if (relative.startsWith('..')) throw new Error(`${file} is outside the folder ${dir}.`);
    return relative;
  });
}

/** The gates the project at the default folder has, that nothing has run yet. */
function gatesNotRun(
  root: string,
  latest: ReadonlyMap<string, Recorded>,
  folder?: string,
): readonly GateName[] {
  const dir = folder ?? gateFolder(root);
  const project = dir === undefined ? undefined : inspectProject(root, dir);
  if (dir === undefined || project === undefined) return [];
  return GATE_NAMES.filter(
    (name) => project.gates[name] !== undefined && !latest.has(`${dir}|${name}`),
  );
}

/** The latest result per folder and gate, and the three operations over them. */
export function createGatesTool(runtime: CommandRuntime = systemCommandRuntime()): GatesTool {
  const latest = new Map<string, Recorded>();

  const runTarget = async (
    gate: GateName,
    target: Target,
    limits: ToolLimits,
    root: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<GateResult> => {
    const project = inspectProject(root, target.dir);
    const result =
      project === undefined
        ? unavailableResult(
            gate,
            target.dir,
            '',
            `no project manifest (package.json, Cargo.toml, go.mod, pyproject.toml) in ${target.dir}`,
          )
        : await runGate({
            gate,
            project,
            workspace: root,
            files: projectFiles(root, target.dir, target.files),
            timeoutMs,
            allowed: limits.allowedExecutables,
            runtime,
            signal,
          });
    latest.set(`${target.dir}|${gate}`, { result, at: Date.now() });
    return result;
  };

  const run = async (
    args: ToolArguments,
    limits: ToolLimits,
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const root = realpathSync(limits.workspace);
    const gate = requireGate(args.gate);
    const timeoutMs = clampedInteger(args.timeoutMs, {
      min: 1000,
      max: GATE_MAX_TIMEOUT_MS,
      fallback: GATE_DEFAULT_TIMEOUT_MS,
    });
    const targets = targetsOf(args, root);
    const results: GateResult[] = [];
    for (const target of targets) {
      results.push(await runTarget(gate, target, limits, root, timeoutMs, signal));
    }
    const [only] = results;
    if (results.length !== 1 || only === undefined) return { scope: 'changed', results };
    const notRun = only.ok ? gatesNotRun(root, latest, only.dir) : [];
    return notRun.length === 0 ? only : { ...only, notRun };
  };

  const report = (limits: ToolLimits): unknown => {
    const entries = [...latest.values()].sort((a, b) => b.at - a.at).slice(0, GATE_REPORT_MAX);
    const notRun = gatesNotRun(realpathSync(limits.workspace), latest);
    const pending = notRun.length === 0 ? {} : { notRun };
    if (entries.length === 0) return { results: [], note: 'no gate has been run yet', ...pending };
    return {
      results: entries.map(({ result, at }) => ({
        ...Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'tail')),
        ageSec: Math.round((Date.now() - at) / 1000),
      })),
      ...pending,
    };
  };

  return {
    execute: (operation, args, limits, signal) => {
      if (operation === 'run') return run(args, limits, signal);
      if (operation === 'report') return report(limits);
      if (operation === 'detect') return detectProjects(args, limits);
      throw new Error(`Unsupported operation ${operation}`);
    },
  };
}
