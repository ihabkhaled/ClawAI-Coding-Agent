import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { env } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { containedPath } from '../core/workspace-containment';
import { prepareGitSpawn } from '../infrastructure/hardened-git';

import { createCommandTool } from './command-tool';
import { runFileTool } from './file-tools';
import { executeGitTool, isGitToolOperation } from './git-tools';
import { guardToolResult } from './tool-result-guard';
import {
  AGENT_GIT_LOG_MAX,
  AGENT_TOOL_OUTPUT_CEILING,
  AGENT_TOOL_TIMEOUT_MS,
} from './workspace-toolkit.constants';
import { assertScopedCall } from './write-scope';

import type { AgentToolCall } from './agent-sdk.types';
import type { CommandTool } from './command-tool.types';
import type { NotesTool } from './notes-tool.types';
import type { ToolLimits } from '../headless/headless-main.types';

/**
 * Runs one workspace tool call on this machine, inside `limits.workspace`.
 *
 * Authorization has already happened by the time this runs; what is enforced
 * here is containment. Every path resolves inside the workspace, every command
 * is on the allowlist and gets a built environment, and git is read-only.
 */
export function executeWorkspaceTool(
  call: AgentToolCall,
  limits: ToolLimits,
  signal?: AbortSignal,
  commands: CommandTool = createCommandTool(),
  notes?: NotesTool,
): unknown {
  const result = dispatchWorkspaceTool(call, limits, signal, commands, notes);
  return result instanceof Promise ? result.then(guardToolResult) : guardToolResult(result);
}

function dispatchWorkspaceTool(
  call: AgentToolCall,
  limits: ToolLimits,
  signal: AbortSignal | undefined,
  commands: CommandTool,
  notes: NotesTool | undefined,
): unknown {
  const args = call.arguments;
  if (limits.writeScope !== undefined) assertScopedCall(call, limits.workspace, limits.writeScope);
  if (call.toolName === 'workspace.notes' && notes !== undefined) {
    return notes.execute(call.operation, args);
  }
  if (call.toolName === 'workspace.command') {
    return commands.execute(call.operation, args, limits, signal);
  }
  if (call.toolName === 'workspace.git') {
    return runGitTool(call.operation, args, limits.workspace, signal);
  }
  if (call.toolName === 'workspace.file')
    return runFileTool(call.operation, args, limits.workspace);
  throw new Error(`Unsupported tool ${call.toolName}`);
}

export { requirePath } from './file-tools';

/**
 * Git with the argument list fixed per operation: status, diff and log here,
 * everything else in `git-tools`. Whether a write may run was decided by
 * `authorize`; a run without the `git-write` grant never gets this far.
 */
function runGitTool(
  operation: string,
  args: Readonly<Record<string, unknown>>,
  workspace: string,
  signal: AbortSignal | undefined,
): unknown {
  if (isGitToolOperation(operation)) return executeGitTool(operation, args, workspace, signal);
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
