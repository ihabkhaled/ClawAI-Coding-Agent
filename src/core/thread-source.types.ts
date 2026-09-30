/**
 * Which surface opened a conversation. Shared by the VS Code extension and the
 * headless CLI (`src/headless/*`), so both write the same vocabulary.
 */
export type ThreadSource = 'vscode' | 'cli' | 'web';

/** The thread origin the chat-service persists (`ThreadOrigin` in its schema). */
export type ThreadOrigin = 'CODING_AGENT' | 'CODING_AGENT_CLI' | 'WEB';

/**
 * What can be read back from a stored thread. `cli` is a thread the headless
 * CLI started; `agent` is one VS Code started, or one an older CLI build wrote
 * before it had its own origin (F094).
 */
export type ThreadSurface = 'agent' | 'cli' | 'web';
