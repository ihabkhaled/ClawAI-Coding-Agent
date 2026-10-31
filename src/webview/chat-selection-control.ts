import type { ControlMessage } from './chat-inbound-message';
import type { ChatViewActions } from './chat-view-actions';

/** The picker and settings messages: each one is a single call on the host actions. */
export async function handleSelectionControl(
  actions: ChatViewActions,
  request: ControlMessage,
  postState: () => Promise<void>,
): Promise<void> {
  if (request.type === 'configureLanguage') {
    await actions.configureLanguage();
  } else if (request.type === 'configureConnections') {
    await actions.configureConnections(request);
  } else if (request.type === 'manageExternalOutputFolders') {
    await actions.manageExternalOutputFolders();
  } else if (request.type === 'selectModel') {
    await actions.selectModel(request.modelKey);
  } else if (request.type === 'selectViewDensity') {
    await actions.selectViewDensity(request.density);
  } else if (request.type === 'selectAgentMode') {
    await actions.selectAgentMode(request.mode);
  } else if (request.type === 'selectEffortMode') {
    await actions.selectEffortMode(request.mode);
  } else if (request.type === 'selectSpeedMode') {
    await actions.selectSpeedMode(request.mode);
  } else if (request.type === 'selectPermissionMode') {
    await actions.selectPermissionMode(request.mode);
    await postState();
  } else if (request.type === 'selectWorkspaceFolder') {
    await actions.selectWorkspaceFolder(request.folderKey);
  }
}
