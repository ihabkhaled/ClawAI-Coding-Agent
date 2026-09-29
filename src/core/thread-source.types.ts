/**
 * Which surface opened a conversation. Shared by the VS Code extension and the
 * headless CLI (`src/headless/*`), so both write the same vocabulary.
 */
export type ThreadSource = 'vscode' | 'cli' | 'web';

/** The thread origin the chat-service persists (`ThreadOrigin` in its schema). */
export type ThreadOrigin = 'CODING_AGENT' | 'WEB';

/**
 * What can be read back from a stored thread. The backend persists only the
 * origin, and both agent surfaces share one origin, so a stored thread can say
 * "agent" or "web" but not which agent surface wrote it.
 */
export type ThreadSurface = 'agent' | 'web';
