import { WebResearchOperations, webResearchToolDefinition } from '../core/web-research-operations';

import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';
import type { WebResearchPort } from '../services/web-research.types';

export { webResearchToolDefinition };

/**
 * The runtime's executor for `workspace.web`.
 *
 * The operations themselves live in `core/web-research-operations`, which the
 * command-line agent also runs; this adds only the runtime's invocation
 * envelope and its tool-name check.
 */
export class WebResearchToolExecutor implements RuntimeToolExecutorPort {
  private readonly operations: WebResearchOperations;

  constructor(research: WebResearchPort) {
    this.operations = new WebResearchOperations(research);
  }

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== webResearchToolDefinition.name) throw new Error('Unknown web tool');
    return this.operations.run(invocation.operation, invocation.arguments, signal);
  }
}
