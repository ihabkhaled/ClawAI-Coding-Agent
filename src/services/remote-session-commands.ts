import * as vscode from 'vscode';

import { attachRemoteSession, stopRunnerSession } from './attach-session-command';
import { startCloudSession } from './cloud-session-command';
import { withFailureNotice } from './command-failure-notice';
import { resumeConversation } from './resume-conversation-command';

import type { RemoteSessionDependencies } from './remote-session-commands.types';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';

/**
 * Registers the commands for work that started outside this window: resuming
 * a conversation from the web portal, another machine or the headless CLI
 * (F094/F095), and starting a session on a registered runner (F098).
 */
export function registerRemoteSessionCommands(
  backend: () => BackendClient,
  state: Pick<ExtensionState, 'snapshot'>,
  view: { revealThread(threadId: string, title: string): Promise<unknown> },
): vscode.Disposable[] {
  const dependencies: RemoteSessionDependencies = {
    request: () => backend().remoteRequest,
    backend,
    agentHistory: () => state.snapshot.history,
    revealThread: (threadId, title) => view.revealThread(threadId, title),
  };
  return [
    vscode.commands.registerCommand('clawAI.resumeConversation', () =>
      withFailureNotice(() => resumeConversation(dependencies)),
    ),
    vscode.commands.registerCommand('clawAI.startCloudSession', () =>
      withFailureNotice(() => startCloudSession(dependencies)),
    ),
    vscode.commands.registerCommand('clawAI.attachRemoteSession', () =>
      withFailureNotice(() => attachRemoteSession(dependencies)),
    ),
    vscode.commands.registerCommand('clawAI.stopCloudSession', () =>
      withFailureNotice(() => stopRunnerSession(dependencies)),
    ),
  ];
}
