import {
  assertMonitorPattern,
  isConditionMet,
  monitorConditionSchema,
  nextPollDelay,
} from '../core/monitor-condition';
import { MAX_MONITOR_MS } from '../core/monitor-condition.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { MonitorPort } from './monitor-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const monitorToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.monitor',
  version: '2.0.0',
  description:
    'Wait for one workspace file to reach a state, then continue. kind is exists, missing, ' +
    'changed, or matches with a pattern tested against the file text. path is relative. ' +
    'timeoutMs is capped at ten minutes and always returns: satisfied says whether the wait ' +
    'ended because the condition held or because time ran out, and the two mean different ' +
    'things. Use it after starting a long command, not to poll something you could read once.',
  operations: ['wait'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.monitor,
};

/**
 * The run's way to wait for something to happen instead of guessing how long.
 *
 * Before this, a run that started a build had two options: read the output file
 * immediately and find it absent, or spend model turns re-reading it. Both waste
 * the budget on the same question.
 *
 * Every wait is bounded twice — by the caller's timeout and by a ceiling the
 * caller cannot raise — and always returns rather than throwing on expiry.
 * "The condition held" and "time ran out" are different facts, and a timeout
 * reported as an error would make the model treat a slow build as a broken one.
 *
 * Polling backs off from a quarter second to five. A condition that resolves
 * quickly is still noticed quickly; one that takes ten minutes costs about a
 * hundred and thirty looks rather than two thousand four hundred.
 */
export class MonitorToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: MonitorPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== monitorToolDefinition.name) throw new Error('Unknown monitor tool');
    if (invocation.operation !== 'wait') throw new Error('Unknown monitor operation');
    const condition = monitorConditionSchema.parse(invocation.arguments);
    assertMonitorPattern(condition.pattern);
    const deadline = this.port.now() + Math.min(condition.timeoutMs, MAX_MONITOR_MS);
    const baseline = await this.port.observe(condition.path);
    let delay = 0;
    let looks = 1;
    if (isConditionMet(condition, baseline, baseline)) {
      return this.result(condition.path, true, 0, looks);
    }
    const started = this.port.now();
    while (this.port.now() < deadline) {
      signal?.throwIfAborted();
      delay = nextPollDelay(delay);
      await this.port.wait(delay, signal);
      const current = await this.port.observe(condition.path);
      looks += 1;
      if (isConditionMet(condition, baseline, current)) {
        return this.result(condition.path, true, this.port.now() - started, looks);
      }
    }
    return this.result(condition.path, false, this.port.now() - started, looks);
  }

  private result(
    path: string,
    satisfied: boolean,
    waitedMs: number,
    looks: number,
  ): RuntimeToolExecutionOutput {
    return { structured: { path, satisfied, waitedMs: Math.max(0, waitedMs), looks } };
  }
}
