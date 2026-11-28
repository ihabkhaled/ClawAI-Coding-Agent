import * as vscode from 'vscode';

import { createClawIconPath } from '../views/claw-icon-path';

import type { AgentCoordinator } from './agent-coordinator';

/** The `@clawai` chat participant: every prompt goes to the same coordinator the panel uses. */
export function registerChatParticipant(
  context: vscode.ExtensionContext,
  coordinator: AgentCoordinator,
): void {
  const participant = vscode.chat.createChatParticipant(
    'clawai.coding-agent',
    async (request, _chatContext, response, token) => {
      await coordinator.chatParticipant.send(request.prompt, response, token);
    },
  );
  participant.iconPath = createClawIconPath(context.extensionUri);
  context.subscriptions.push(participant);
}
