import type { ToolDefinition, ToolInvocation } from './core/runtime/runtime-tool-contracts';
import type { RuntimeConfiguration } from './services/configuration-service';
import type { RuntimeToolExecutionOutput } from './services/runtime-tool-dispatcher';

/**
 * What the extension hands the extension-host test runner, and nothing else.
 *
 * Present only when VS Code launched the extension in test mode. It exists so
 * the real tool executors — the file transactions, the command runner, git —
 * can be driven against a real workspace inside a real editor, which no unit
 * test and no browser lane can do.
 */
export interface ClawTestApi {
  /**
   * The settings as the extension actually resolves them.
   *
   * Every contributed setting had a row saying its schema was verified and its
   * behaviour never exercised. Reading the manifest proves a default exists;
   * only asking the extension what it resolved proves the value is consumed.
   */
  readonly configuration: () => RuntimeConfiguration;
  readonly toolDefinitions: () => readonly ToolDefinition[];
  /**
   * Runs one tool call. The signal lets a test abandon a call that is waiting
   * on a person — a commit waits for its staged diff to be approved — instead
   * of hanging the host until the runner kills it.
   */
  readonly executeTool: (
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ) => Promise<RuntimeToolExecutionOutput>;
}
