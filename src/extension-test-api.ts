import * as vscode from 'vscode';

import type { ClawTestApi } from './extension-test-api.types';
import type { RuntimeToolRouter } from './services/runtime-tool-router';

/**
 * The test API, or nothing.
 *
 * Gated on `ExtensionMode.Test`, which VS Code sets only when the extension is
 * launched by a test runner through `extensionTestsPath`. An installed
 * extension runs in `Production` and a developer's F5 session in
 * `Development`, so neither can reach this — there is no setting, flag or
 * environment variable a user or a workspace could use to turn it on.
 *
 * The API calls the router directly and so skips run admission. That is the
 * point of it — it proves the executors do what they claim against a real
 * workspace — and it is also why the gate above must stay the only way in.
 */
export function testApiFor(
  mode: vscode.ExtensionMode,
  router: () => RuntimeToolRouter,
): ClawTestApi | undefined {
  if (mode !== vscode.ExtensionMode.Test) return undefined;
  return {
    toolDefinitions: () => router().definitions(),
    executeTool: (invocation, signal) => router().execute(invocation, signal),
  };
}
