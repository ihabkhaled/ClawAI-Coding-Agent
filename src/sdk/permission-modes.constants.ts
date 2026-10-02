import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'plan',
  'ask',
  'accept-edits',
  'autonomous-scoped',
  'strict',
];

/**
 * Everything a mode-gated run may use unless the caller narrows it. The newer
 * categories (`http`, `http-write`, `browser`, `shell`, `agents`) are NOT here:
 * each needs its own flag (a host list, the shell's second switch, `--max-agents`
 * or an explicit `--allow-tools`), so a permission mode never widens a run to them.
 */
export const AGENT_ALL_TOOL_CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'mcp',
];

/**
 * Operations of a tool in the `command` category that start nothing and change
 * nothing: watching, reading output, stopping a process the run itself started,
 * reading detected gates. They are never put to an approver.
 */
export const COMMAND_TOOL_OBSERVATIONS: Readonly<Record<string, readonly string[]>> = {
  'process.watch': ['status', 'output', 'wait', 'list', 'stop'],
  'code.gates': ['detect', 'report'],
};

/** What plan mode leaves: inspection only, nothing that changes anything. */
export const AGENT_PLAN_TOOL_CATEGORIES: readonly AgentToolCategory[] = ['read', 'git', 'http'];
