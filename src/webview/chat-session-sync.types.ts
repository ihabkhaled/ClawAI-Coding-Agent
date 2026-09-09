import type { ChatSessionTarget } from './chat-session-registry';
import type { AgentRunPhase } from '../core/agent-run';

/**
 * The part of a webview panel a tab's state actually needs.
 *
 * Narrowed rather than taking `vscode.WebviewPanel` so the sync logic can be
 * tested without a running editor. Everything here is what a tab is: whether
 * the user is looking at it, what it says, and how to tell it something.
 */
export interface SessionTab extends ChatSessionTarget {
  active: boolean;
  title: string;
  webview: { postMessage(message: unknown): PromiseLike<boolean> };
}

/** One run a session owns, reduced to what its tab needs to know. */
export interface SessionRun {
  phase: AgentRunPhase;
  awaitingAnswer: boolean;
}
