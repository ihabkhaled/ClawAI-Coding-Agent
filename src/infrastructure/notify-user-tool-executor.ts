import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { userNotificationInputSchema } from '../core/user-notification';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { UserNotificationInput } from '../core/user-notification';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export interface UserNotificationPort {
  notify(input: UserNotificationInput): void;
}

export const notifyUserToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.notify',
  version: '2.0.0',
  description:
    'Tell the user something worth leaving what they are doing for. Arguments: message is one ' +
    'sentence of at most 500 characters, kind is "info" or "warning". Use it when a long run ' +
    'reaches a result they are waiting on, not for progress they can already see in the panel. ' +
    'It does not ask anything and returns nothing to act on — use runtime.ask for a decision.',
  operations: ['notify'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.notify,
};

/**
 * The agent's one way to reach a user who has walked away.
 *
 * Deliberately fire-and-forget. An approval blocks the run until it settles
 * and a question waits for an answer, so both have a result worth returning;
 * a notification has nothing to wait for, and pretending otherwise would give
 * a model a reason to stall a run on an acknowledgement that never comes.
 */
export class NotifyUserToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly notifications: UserNotificationPort) {}

  /**
   * Synchronous under a promise-returning signature, and deliberately not
   * `async`: handing a message to a fire-and-forget surface waits on nothing,
   * so there is no I/O here to make asynchronous honestly. The dispatcher
   * evaluates this call inside its own `try`, so a rejected promise and a
   * thrown error reach exactly the same handler.
   */
  execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== notifyUserToolDefinition.name) {
      throw new Error('Unknown notify tool');
    }
    if (invocation.operation !== 'notify') throw new Error('Unknown notify operation');
    const input = userNotificationInputSchema.parse(invocation.arguments);
    this.notifications.notify(input);
    return Promise.resolve({ structured: { delivered: true, kind: input.kind } });
  }
}
