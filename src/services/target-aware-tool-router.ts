import type { ExecutionTargetRegistry } from './execution-target-registry';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from './runtime-tool-dispatcher';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export class TargetAwareToolRouter implements RuntimeToolExecutorPort {
  constructor(
    private readonly targets: ExecutionTargetRegistry,
    private readonly delegates: ReadonlyMap<string, RuntimeToolExecutorPort>,
  ) {}

  execute(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput> {
    this.targets.select(invocation);
    const executor = this.delegates.get(invocation.targetId);
    if (executor === undefined)
      throw new Error('Execution target is online but has no local adapter');
    return executor.execute(invocation, signal);
  }
}
