import {
  HttpRequestToolExecutor,
  httpRequestToolDefinition,
} from '../infrastructure/http-request-tool-executor';
import {
  ShellScriptToolExecutor,
  shellScriptToolDefinition,
} from '../infrastructure/shell-script-tool-executor';
import { liveOptInToolSettings } from '../infrastructure/vscode-opt-in-tool-settings';

import type { RuntimeToolRegistration } from './runtime-tool-router';
import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';

/**
 * The tools that stay off until the user switches them on in settings.
 *
 * Registered unconditionally and offered only when the capability manifest
 * advertises them, which it does only for a non-empty `clawAI.tools.httpAllowHosts`
 * or a true `clawAI.tools.shellEnabled`. Each executor also checks its setting
 * on every call, so turning a setting off stops a run that was already offered
 * the tool.
 */
export function optInToolRegistrations(
  files: VscodeFileTransactionAdapter,
): RuntimeToolRegistration[] {
  const settings = liveOptInToolSettings();
  const resolveRoot = (key: string): string => files.workspaceRootUri(key).fsPath;
  return [
    { definition: httpRequestToolDefinition, executor: new HttpRequestToolExecutor(settings) },
    {
      definition: shellScriptToolDefinition,
      executor: new ShellScriptToolExecutor(settings, resolveRoot),
    },
  ];
}
