import path from 'node:path';

import { redactText } from '../core/redaction';

import { parseExtras } from './agent-team-extras';
import {
  TEAM_MAX_TOTAL,
  TEAM_MAX_WAIT_NAMES,
  TEAM_MAX_WRITE_GLOBS,
  TEAM_MIN_CONCURRENCY,
  TEAM_NAME_PATTERN,
  TEAM_RESERVED_NAMES,
  TEAM_TASK_MAX_CHARS,
  TEAM_WAIT_DEFAULT_MS,
  TEAM_WAIT_MAX_MS,
} from './agent-team-tool.constants';
import { writeScopeProblem } from './write-scope';

import type { SpawnRequest } from './agent-team-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

type Args = Readonly<Record<string, unknown>>;

const CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'mcp',
  'http',
  'http-write',
  'browser',
  'agents',
];

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/u;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** A usable agent name, or the sentence saying what is wrong with it. */
export function nameProblem(raw: unknown, field: string): string | undefined {
  const name = text(raw);
  if (name.length === 0) return `${field} needs a name (a-z, 0-9 and -, up to 24 characters).`;
  if (!TEAM_NAME_PATTERN.test(name)) {
    return `"${redactText(name).slice(0, 40)}" is not a valid name: use a-z, 0-9 and -, starting with a letter, up to 24 characters.`;
  }
  return undefined;
}

export function agentName(raw: unknown): string {
  return text(raw);
}

function categories(raw: unknown): readonly AgentToolCategory[] | string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw))
    return '"tools" is a list of: read, write, command, git, git-write, http, http-write, browser, agents.';
  const found: AgentToolCategory[] = [];
  for (const entry of raw) {
    const category = CATEGORIES.find((candidate) => candidate === entry);
    if (category === undefined || category === 'mcp') {
      return `"${String(entry).slice(0, 30)}" is not a tool category a child can be given: use read, write, command, git, git-write, http, http-write, browser, agents (shell is the "shell": true switch).`;
    }
    found.push(category);
  }
  return [...new Set(found)];
}

function globs(raw: unknown): readonly string[] | string | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    return '"writeScope" is a list of workspace-relative globs.';
  }
  const list = raw.filter((entry): entry is string => typeof entry === 'string');
  if (list.length > TEAM_MAX_WRITE_GLOBS) {
    return `"writeScope" takes at most ${String(TEAM_MAX_WRITE_GLOBS)} globs.`;
  }
  return writeScopeProblem(list, []) ?? list;
}

function whole(
  raw: unknown,
  field: string,
  low: number,
  high: number,
): number | string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < low || raw > high) {
    return `${field} is a whole number from ${String(low)} to ${String(high)}.`;
  }
  return raw;
}

/** A folder inside the workspace, relative and forward-slash; the empty string is the workspace itself. */
export function subdirectoryOf(raw: unknown): string | undefined | { readonly problem: string } {
  if (raw === undefined) return undefined;
  const value = text(raw).replaceAll('\\', '/');
  const normal = path.posix.normalize(value).replace(/^\.\//u, '').replace(/\/$/u, '');
  if (value.length === 0 || value.includes('\0')) return { problem: '"workspaceSubdir" is empty.' };
  if (path.isAbsolute(value) || /^[a-zA-Z]:/u.test(value) || normal.startsWith('..')) {
    return { problem: '"workspaceSubdir" must be a folder inside the workspace.' };
  }
  return normal === '.' ? undefined : normal;
}

type Checked = { readonly request: SpawnRequest } | { readonly problem: string };

function firstProblem(...values: readonly unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string');
}

type Brief = { readonly name: string; readonly task: string } | string;

function briefOf(args: Args): Brief {
  const nameIssue = nameProblem(args.name, 'spawn');
  if (nameIssue !== undefined) return nameIssue;
  const name = agentName(args.name);
  if (TEAM_RESERVED_NAMES.includes(name)) return `"${name}" is reserved; pick another name.`;
  const task = text(args.task);
  if (task.length === 0) return 'spawn needs a "task": a self-contained brief.';
  if (task.length > TEAM_TASK_MAX_CHARS) {
    return `The task is over ${String(TEAM_TASK_MAX_CHARS)} characters; shorten it.`;
  }
  return { name, task: redactText(task) };
}

type Limits = Pick<SpawnRequest, 'tools' | 'writeScope' | 'maxToolCalls' | 'maxDurationSec'>;

function limitsOf(args: Args): Limits | string {
  const budget = isRecord(args.budget) ? args.budget : {};
  const tools = categories(args.tools);
  const scope = globs(args.writeScope);
  const calls = whole(budget.maxToolCalls, 'budget.maxToolCalls', 1, 2_000);
  const seconds = whole(budget.maxDurationSec, 'budget.maxDurationSec', 10, 7_200);
  const issue = firstProblem(tools, scope, calls, seconds);
  if (issue !== undefined) return issue;
  return {
    tools: typeof tools === 'string' ? undefined : tools,
    writeScope: typeof scope === 'string' ? undefined : scope,
    maxToolCalls: typeof calls === 'number' ? calls : undefined,
    maxDurationSec: typeof seconds === 'number' ? seconds : undefined,
  };
}

type Placement = Pick<SpawnRequest, 'model' | 'workspaceSubdir' | 'isolation'>;

function placementOf(args: Args): Placement | string {
  const subdir = subdirectoryOf(args.workspaceSubdir);
  if (typeof subdir === 'object') return subdir.problem;
  const model = text(args.model);
  if (model.length > 0 && !MODEL_PATTERN.test(model)) return '"model" is not a model id.';
  const isolation = args.isolation ?? 'none';
  if (isolation !== 'none' && isolation !== 'worktree') return '"isolation" is none or worktree.';
  return {
    model: model.length === 0 ? undefined : model,
    workspaceSubdir: subdir,
    isolation,
  };
}

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A spawn request from the model's arguments, or what is wrong with them. */
export function parseSpawn(args: Args): Checked {
  const brief = briefOf(args);
  if (typeof brief === 'string') return { problem: brief };
  const limits = limitsOf(args);
  if (typeof limits === 'string') return { problem: limits };
  const placement = placementOf(args);
  if (typeof placement === 'string') return { problem: placement };
  const extras = parseExtras(args);
  if (typeof extras === 'string') return { problem: extras };
  return { request: { ...brief, ...limits, ...placement, ...extras } };
}

/** The names a `wait` is for, or undefined for "all of mine"; a string is a problem. */
export function parseNames(raw: unknown): readonly string[] | undefined | string {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > TEAM_MAX_WAIT_NAMES) {
    return `"names" is a list of at most ${String(TEAM_MAX_WAIT_NAMES)} child names.`;
  }
  return raw.map((entry) => text(entry)).filter((entry) => entry.length > 0);
}

/** The wait, in milliseconds, within what a single call may take. */
export function parseTimeout(raw: unknown): number | string {
  if (raw === undefined) return TEAM_WAIT_DEFAULT_MS;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
    return '"timeoutMs" is a number of milliseconds.';
  }
  return Math.min(Math.trunc(raw), TEAM_WAIT_MAX_MS);
}

/** Why `maxAgents` cannot be used, or undefined when it can (or is absent). */
export function maxAgentsProblem(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const high = TEAM_MAX_TOTAL;
  return Number.isInteger(value) && value >= TEAM_MIN_CONCURRENCY && value <= high
    ? undefined
    : `maxAgents must be a whole number from ${String(TEAM_MIN_CONCURRENCY)} to ${String(high)}.`;
}
