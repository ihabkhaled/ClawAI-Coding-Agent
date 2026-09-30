/**
 * What a runner may approve on its own for a prompt job. Mirrors agent-service
 * `RunnerApprovalPolicy`. Only ever widens to read-only tool calls.
 */
export type RunnerApprovalPolicy = 'ASK' | 'AUTO_APPROVE_READ_ONLY';

/** `auto` runs the call; `ask` waits for the person at the runner; no answer is a refusal. */
export type RunnerToolDecision = 'auto' | 'ask';

/** The SDK's tool categories (`AgentToolCategory`), restated so core depends on nothing. */
export type RunnerToolCategory = 'read' | 'write' | 'command' | 'git' | 'git-write' | 'mcp';

export interface RunnerToolRequest {
  readonly category: RunnerToolCategory;
}

/** A workspace folder open on the runner, by name and path. */
export interface RunnerWorkspaceFolder {
  readonly name: string;
  readonly fsPath: string;
}
