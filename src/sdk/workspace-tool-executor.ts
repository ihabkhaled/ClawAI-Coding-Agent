import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { containedPath } from '../core/workspace-containment';
import { isAllowedExecutable } from '../headless/headless-command-policy';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import {
  AGENT_GIT_LOG_MAX,
  AGENT_TOOL_OUTPUT_CEILING,
  AGENT_TOOL_TIMEOUT_MS,
} from './workspace-toolkit.constants';

import type { AgentToolCall } from './agent-sdk.types';
import type { ToolLimits } from '../headless/headless-main.types';

/**
 * Runs one workspace tool call on this machine, inside `limits.workspace`.
 *
 * Authorization has already happened by the time this runs; what is enforced
 * here is containment. Every path resolves inside the workspace, every command
 * is on the allowlist and gets a built environment, and git is read-only.
 */
export function executeWorkspaceTool(call: AgentToolCall, limits: ToolLimits): unknown {
  const args = call.arguments;
  if (call.toolName === 'workspace.command') return runCommandTool(args, limits);
  if (call.toolName === 'workspace.git') return runGitTool(call.operation, args, limits.workspace);
  if (call.toolName === 'workspace.file')
    return runFileTool(call.operation, args, limits.workspace);
  throw new Error(`Unsupported tool ${call.toolName}`);
}

function runFileTool(
  operation: string,
  args: Readonly<Record<string, unknown>>,
  workspace: string,
): unknown {
  if (operation === 'list') return { entries: readdirSync(workspace) };
  if (operation === 'read') {
    return {
      content: readFileSync(containedPath(workspace, requirePath(operation, args)), 'utf8'),
    };
  }
  if (operation === 'create') {
    const relative = requirePath(operation, args);
    const target = containedPath(workspace, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, typeof args.content === 'string' ? args.content : '', 'utf8');
    return { written: relative };
  }
  throw new Error(`Unsupported operation ${operation}`);
}

/**
 * Refuses a read or create that named no file.
 *
 * A missing `path` used to fall back to `.`, which resolves to the workspace
 * directory itself, so the write failed with EISDIR — a message about
 * directories that says nothing about the actual mistake. Naming the missing
 * argument lets the model correct itself on the next turn.
 */
export function requirePath(operation: string, args: Readonly<Record<string, unknown>>): string {
  const value = args.path;
  if (typeof value === 'string' && value.trim().length > 0) return value;
  const provided = Object.keys(args).join(', ');
  throw new Error(
    `workspace.file ${operation} requires a "path" argument. Received: ${provided.length > 0 ? provided : 'nothing'}.`,
  );
}

/**
 * Runs a bounded command, inside the allowlist and with a built environment.
 *
 * The environment is built from nothing rather than inherited, because the
 * process running an agent is the one most likely to be holding a credential,
 * and the command the model chose only has to print it.
 */
function runCommandTool(args: Readonly<Record<string, unknown>>, limits: ToolLimits): unknown {
  const executable = typeof args.executable === 'string' ? args.executable : '';
  if (!isAllowedExecutable(executable, limits.allowedExecutables)) {
    throw new Error(
      `Command ${executable} is not allowed. Allowed: ${limits.allowedExecutables.join(', ')}.`,
    );
  }
  return spawnBounded(executable, toStrings(args.arguments), limits.workspace);
}

/** Read-only git, with the argument list fixed per operation. */
function runGitTool(
  operation: string,
  args: Readonly<Record<string, unknown>>,
  workspace: string,
): unknown {
  return spawnBounded('git', gitArguments(operation, args, workspace), workspace);
}

export function gitArguments(
  operation: string,
  args: Readonly<Record<string, unknown>>,
  workspace: string,
): string[] {
  if (operation === 'status') return ['status', '--porcelain=v1', '--branch'];
  if (operation === 'log') {
    const requested = typeof args.maxCount === 'number' ? Math.trunc(args.maxCount) : 20;
    const count = Math.min(Math.max(requested, 1), AGENT_GIT_LOG_MAX);
    return ['log', '--oneline', '--no-color', '-n', String(count)];
  }
  if (operation === 'diff') {
    const base = ['diff', '--no-color', ...(args.staged === true ? ['--cached'] : [])];
    if (typeof args.path !== 'string' || args.path.length === 0) return base;
    // Contained first, then made relative again: the check is on the resolved
    // path, and `--` keeps a name that starts with a dash from reading as a flag.
    const relative = path.relative(workspace, containedPath(workspace, args.path));
    return [...base, '--', relative.length === 0 ? '.' : relative];
  }
  throw new Error(`workspace.git ${operation} is not available; only status, diff and log are.`);
}

function spawnBounded(executable: string, argumentList: string[], cwd: string): unknown {
  const prepared = prepareGitSpawn(executable, argumentList, cwd, inheritedEnvironment(env));
  const finished = spawnSync(executable, prepared.arguments, {
    cwd,
    encoding: 'utf8',
    timeout: AGENT_TOOL_TIMEOUT_MS,
    shell: false,
    env: prepared.environment,
  });
  return {
    exitCode: finished.status ?? -1,
    stdout: captured(finished.stdout).slice(0, AGENT_TOOL_OUTPUT_CEILING),
    stderr: captured(finished.stderr).slice(0, AGENT_TOOL_OUTPUT_CEILING),
  };
}

/**
 * A captured stream, read as what actually arrives. The declarations promise a
 * string; a spawn that failed or timed out delivers null.
 */
function captured(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}
