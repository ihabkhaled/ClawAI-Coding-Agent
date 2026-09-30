import type { BackendClient } from '../backend/backend-client';
import type { ChatThread } from '../backend/contracts';
import type { RemoteRequester } from '../backend/remote-session-client';

/** What the resume and cloud-session commands need from the composed extension. */
export interface RemoteSessionDependencies {
  /** The authenticated request seam, read per use: sign-in replaces the client. */
  readonly request: () => RemoteRequester;
  readonly backend: () => Pick<
    BackendClient,
    'listMessages' | 'cancelStream' | 'createThread' | 'sendMessage'
  >;
  /** The agent history the sidebar already holds: VS Code and CLI threads. */
  readonly agentHistory: () => readonly ChatThread[];
  readonly revealThread: (threadId: string, title: string) => Promise<unknown>;
}

/** How a cloud session is watched: bounded, so a stuck runner cannot poll forever. */
export interface CloudWatchPolicy {
  readonly intervalMs: number;
  readonly maxPolls: number;
}
