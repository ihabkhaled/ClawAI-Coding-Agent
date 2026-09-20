/** How long one agent-run command may take before it is killed. */
export const LIVE_COMMAND_TIMEOUT_MS = 30_000;

/** The events that end a run, whatever the outcome. */
export const LIVE_TERMINAL_EVENTS = ['run.completed', 'run.failed', 'run.cancelled', 'run.blocked'];

/**
 * The tools a live round offers the model.
 *
 * Deliberately the same two the extension's own live check has always offered:
 * a file tool and an unrestricted command runner. The command runner is what
 * makes git, npm and shell rounds possible without a third definition — the
 * model asks for `git` or `node` as the executable, and the agent's real
 * capability is exactly its ability to choose correctly.
 */
export const LIVE_TOOL_DEFINITIONS = [
  {
    schemaVersion: '2.0',
    name: 'workspace.file',
    version: '2.0.0',
    description: 'Read, write and list files in the workspace.',
    operations: ['read', 'create', 'list'],
    riskClasses: ['inspect', 'workspace-write'],
    targetIds: ['target:workspace'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', maxLength: 4096 },
        content: { type: 'string', maxLength: 100000 },
      },
    },
  },
  {
    schemaVersion: '2.0',
    name: 'workspace.command',
    version: '2.0.0',
    description: 'Run a bounded command in the workspace and return its output.',
    operations: ['run'],
    riskClasses: ['process'],
    targetIds: ['target:workspace'],
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        executable: { type: 'string', maxLength: 200 },
        arguments: { type: 'array', items: { type: 'string', maxLength: 4096 }, maxItems: 50 },
      },
      required: ['executable'],
    },
  },
];

/** What one round may spend before it is cut off. */
export const LIVE_DEFAULT_BUDGET = {
  maxModelTurns: 20,
  maxToolCalls: 30,
  maxToolRounds: 20,
  maxRepairAttempts: 1,
  maxRuntimeMs: 300_000,
  maxOutputBytes: 1_048_576,
  maxToolResultBytes: 262_144,
};

/** How long before expiry a sweep re-authorises rather than risk a 401. */
export const TOKEN_REFRESH_MARGIN_MS = 120_000;

/** Used only when a token carries no readable `exp`. */
export const TOKEN_ASSUMED_LIFETIME_MS = 600_000;

/** How long a sweep waits for a restarting backend before giving up on it. */
export const BACKEND_READY_TIMEOUT_MS = 180_000;

export const BACKEND_READY_POLL_MS = 3_000;
