import * as vscode from 'vscode';

import { toggleViewDensity } from '../core/view-density';

import { pickModelKey } from './agent-coordinator-prompts';
import { applyModelSelection } from './agent-coordinator-runtime';
import { compactConversation } from './compact-conversation-command';
import { searchRunHistory } from './search-run-history-command';
import { selectOutputStyle } from './select-output-style-command';
import { sendFeedback } from './send-feedback-command';
import { showSessionRecap } from './session-recap-command';
import { showUsage } from './show-usage-command';
import { askSideQuestion } from './side-question-command';
import { archiveChat, browseArchivedChats, renameChat } from './thread-organization-command';
import { exportTranscript } from './transcript-export-command';

import type { AgentConnectionService } from './agent-connection-service';
import type { ClawaiInitializer } from './clawai-initializer';
import type { ConfigurationService } from './configuration-service';
import type { ConversationSessionService } from './conversation-session-service';
import type { FindingsService } from './findings-service';
import type { OutputStyleCatalog } from './output-style-catalog';
import type { RunJournalService } from './run-journal-service';
import type { SafeEditService } from './safe-edit-service';
import type { SessionControlService } from './session-control-service';
import type { SideQuestionThread } from './side-question-thread';
import type { ThreadOrganizationDependencies } from './thread-organization.types';
import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { ChatViewProvider } from '../webview/chat-view-provider';

export interface CoordinatorCommands {
  refreshModels(): Promise<void>;
  initializeWorkspace(): Promise<void>;
  exportTranscript(): Promise<void>;
  sendFeedback(): Promise<void>;
  searchRunHistory(): Promise<void>;
  showUsage(): Promise<void>;
  showSessionRecap(): Promise<void>;
  selectOutputStyle(): Promise<void>;
  compactConversation(): Promise<void>;
  askSideQuestion(): Promise<void>;
  toggleFocusView(): Promise<void>;
  renameChat(): Promise<void>;
  archiveChat(): Promise<void>;
  browseArchivedChats(): Promise<void>;
  undoLastEdit(): Promise<void>;
  selectModel(modelKey?: string): Promise<void>;
}

interface CommandCollaborators {
  readonly connection: () => AgentConnectionService;
  readonly initializer: () => ClawaiInitializer;
  readonly conversations: () => ConversationSessionService;
  readonly state: () => ExtensionState;
  readonly safeEdits: () => SafeEditService;
  readonly undoDepth: () => number;
  readonly journals: () => RunJournalService;
  readonly findings: () => FindingsService;
  readonly view: () => ChatViewProvider | null;
  readonly configuration: () => ConfigurationService;
  readonly backend: () => BackendClient;
  readonly refreshHistory: () => Promise<void>;
  readonly sessionControls: () => SessionControlService;
  readonly outputStyles: () => OutputStyleCatalog;
  readonly sideQuestions: () => SideQuestionThread;
  readonly summarize: () => (threadId: string, instruction: string) => Promise<string>;
  readonly startContinuation: () => (seed: string) => Promise<void>;
}

/**
 * Palette commands that are pass-throughs to one collaborator.
 *
 * They live beside the coordinator for the same reason the boundaries,
 * interruptions and workflow actions do: the class sits on a 500-line ceiling
 * and a delegation is not worth spending it on. Two consecutive batches pushed
 * it over by two or three lines, which is the ceiling doing its job — the fix
 * is to move a group out, not to shorten a line.
 */
function threadParts(parts: CommandCollaborators): ThreadOrganizationDependencies {
  return {
    backend: parts.backend,
    state: parts.state,
    refreshHistory: parts.refreshHistory,
  };
}

export function coordinatorCommands(parts: CommandCollaborators): CoordinatorCommands {
  return {
    refreshModels: () => parts.connection().refresh(),
    initializeWorkspace: () => parts.initializer().promptAndInitialize(),
    exportTranscript: () =>
      exportTranscript({ conversations: parts.conversations(), state: parts.state() }),
    searchRunHistory: () => searchRunHistory({ journals: parts.journals() }),
    showUsage: () => showUsage({ state: parts.state() }),
    askSideQuestion: () =>
      askSideQuestion({
        scratchThreadId: () => parts.sideQuestions().id(),
        ask: (threadId, question) => parts.summarize()(threadId, question),
        openAnswer: async (markdown) => {
          const document = await vscode.workspace.openTextDocument({
            content: markdown,
            language: 'markdown',
          });
          await vscode.window.showTextDocument(document, { preview: false });
        },
      }),
    compactConversation: () =>
      compactConversation({
        activeThreadId: () => parts.view()?.activeThreadId(),
        summarize: (threadId, instruction) => parts.summarize()(threadId, instruction),
        startContinuation: (seed) => parts.startContinuation()(seed),
      }),
    selectOutputStyle: () =>
      selectOutputStyle({
        styles: parts.outputStyles(),
        configuration: parts.configuration(),
      }),
    toggleFocusView: () =>
      parts
        .sessionControls()
        .selectViewDensity(toggleViewDensity(parts.state().snapshot.viewDensity)),
    renameChat: () => renameChat(threadParts(parts)),
    archiveChat: () => archiveChat(threadParts(parts)),
    browseArchivedChats: () => browseArchivedChats(threadParts(parts)),
    sendFeedback: () =>
      sendFeedback({
        backend: parts.backend,
        state: parts.state(),
      }),
    // Undo can now be run repeatedly, so the notice says whether there is
    // anything left to take back. Without that, a user cannot tell a stack with
    // more history from one that has reached the end.
    showSessionRecap: () =>
      showSessionRecap({ journals: parts.journals(), findings: parts.findings() }),
    undoLastEdit: async () => {
      if (!(await parts.safeEdits().undoLast())) return;
      const remaining = parts.undoDepth();
      await parts
        .view()
        ?.postNotice(
          remaining === 0
            ? vscode.l10n.t('ClawAI changes were undone. There is nothing earlier to undo.')
            : vscode.l10n.t(
                'ClawAI changes were undone. {0} earlier changes can still be undone.',
                String(remaining),
              ),
        );
    },
    selectModel: (modelKey) =>
      applyModelSelection(modelKey, parts.state(), parts.configuration(), () =>
        pickModelKey(parts.state().snapshot.models),
      ),
  };
}
