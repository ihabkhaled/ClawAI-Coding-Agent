import type { AgentPermissionMode } from './permission-modes.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'plan',
  'ask',
  'accept-edits',
];

/** Everything a mode-gated run may use unless the caller narrows it. */
export const AGENT_ALL_TOOL_CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'mcp',
];

/** What plan mode leaves: inspection only, nothing that changes anything. */
export const AGENT_PLAN_TOOL_CATEGORIES: readonly AgentToolCategory[] = ['read', 'git'];
