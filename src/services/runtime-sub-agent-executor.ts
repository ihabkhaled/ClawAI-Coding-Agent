import { createHash, randomUUID } from 'node:crypto';

import { fileTransactionSchema } from '../core/file-transaction';
import { findingsSchema, type Finding } from '../core/findings';
import { subAgentGraphSchema } from '../core/multi-agent-dag';
import { resolveSubAgentDefinition } from '../core/sub-agent-definitions';

import { RuntimeRunService } from './runtime-run-service';

import type { RuntimeEventStreamService } from './runtime-event-stream-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
  RuntimeToolPolicyDecision,
  RuntimeToolPolicyPort,
} from './runtime-tool-dispatcher';
import type { SubAgentExecutionPort } from './sub-agent-coordinator-service';
import type { BackendClient } from '../backend/backend-client';
import type { SubAgentGraph, SubAgentOutcome, SubAgentTask } from '../core/multi-agent-dag';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { SubAgentDefinition } from '../core/sub-agent-definitions';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

export interface RuntimeSubAgentDependencies {
  readonly backend: () => BackendClient;
  readonly currentEpochs: () => ToolInvocation['epochs'];
  readonly definitions: () => readonly ToolDefinition[];
  readonly executor: RuntimeToolExecutorPort;
  readonly policy: RuntimeToolPolicyPort;
  readonly stream: RuntimeEventStreamService;
  readonly transport: BackendRuntimeTransport;
  /** Named sub-agent presets a task may reference by `definitionName`. */
  readonly subAgentPresets: () => Promise<readonly SubAgentDefinition[]>;
}

interface SubAgentTelemetry {
  changedPaths: Set<string>;
  artifacts: Set<string>;
  findings: Finding[];
  tokens: number;
  toolCalls: number;
  modelTurns: number;
  status: SubAgentOutcome['status'];
  blocker?: string;
  graph?: SubAgentGraph;
}

// The nested runtime's own `run.failed` event carries the real reason (code +
// message), but this executor's report to the user only ever showed the
// generic "Nested runtime failed" — every distinct failure looked identical,
// with nothing to act on. This surfaces what the nested runtime actually said.
export function describeSubAgentFailure(payload: Record<string, unknown>): string {
  const reason = payload.reason;
  if (reason === null || typeof reason !== 'object') return 'Nested runtime failed';
  const record = reason as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code : '';
  const message = typeof record.message === 'string' ? record.message : '';
  if (code.length === 0 && message.length === 0) return 'Nested runtime failed';
  if (message.length === 0) return `Nested runtime failed: ${code}`;
  if (code.length === 0) return `Nested runtime failed: ${message}`;
  return `Nested runtime failed: ${message} (${code})`;
}

/**
 * Builds the prompt handed to a sub-agent's own runtime.
 *
 * A named preset (`resolveSubAgentDefinition`) only ever adds instructions —
 * its `systemPrompt` and `description` — never a runtime parameter. Tools,
 * model, and budget still come from the task alone, so a definition cannot be
 * used to grant a wider scope than the task itself declares.
 */
export function buildSubAgentPrompt(
  task: SubAgentTask,
  steering: readonly string[],
  preset: SubAgentDefinition | undefined,
): string {
  return [
    `Role: ${task.role}`,
    preset === undefined ? '' : `Definition: ${preset.name} — ${preset.description}`,
    preset === undefined ? '' : preset.systemPrompt,
    `Goal: ${task.goal}`,
    `Worktree/root key: ${task.worktreeId}`,
    `Declared write set: ${task.writeSet.join(', ') || '(read-only)'}`,
    `Acceptance checks:\n${task.acceptanceChecks.map((check) => `- ${check}`).join('\n')}`,
    steering.length === 0 ? '' : `Current steering:\n${steering.join('\n')}`,
    'Do not broaden scope, elevate, push, publish, or access another root.',
  ]
    .filter((part) => part.length > 0)
    .join('\n\n');
}

export class RuntimeSubAgentExecutor implements SubAgentExecutionPort {
  constructor(private readonly dependencies: RuntimeSubAgentDependencies) {}

  async execute(
    task: SubAgentTask,
    steering: () => readonly string[],
    signal: AbortSignal,
  ): Promise<SubAgentOutcome> {
    const definitions = this.allowedDefinitions(task);
    if (definitions.length === 0) return this.blocked(task, 'No admitted tools match the task');
    const preset = resolveSubAgentDefinition(
      await this.dependencies.subAgentPresets(),
      task.definitionName,
    );
    const selection = this.modelSelection(task);
    const thread = await this.dependencies.backend().createThread({
      title: `[${task.role}] ${task.goal.slice(0, 120)}`,
      routingMode: selection.provider === 'AUTO' ? 'AUTO' : 'MANUAL_MODEL',
      ...(selection.provider === 'AUTO' ? {} : { preferredProvider: selection.provider }),
      ...(selection.model === 'AUTO' ? {} : { preferredModel: selection.model }),
    });
    const telemetry = this.telemetry();
    const scopedExecutor = new ScopedSubAgentExecutor(task, this.dependencies.executor, telemetry);
    const runtime = new RuntimeRunService({
      clock: { now: Date.now },
      currentEpochs: this.dependencies.currentEpochs,
      eventSink: { publishBatch: () => undefined },
      executor: scopedExecutor,
      policy: new ScopedSubAgentPolicy(task, this.dependencies.policy),
      receiptId: () => `receipt:${randomUUID()}`,
      transport: this.dependencies.transport,
    });
    const requestId = `subagent:${randomUUID()}`;
    const receipt = await runtime.start({
      runId: `runtime:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
      threadId: thread.id,
      clientRequestId: requestId,
      idempotencyKey: requestId,
      prompt: buildSubAgentPrompt(task, steering(), preset),
      manifestHash: this.hash({ taskId: task.taskId, worktreeId: task.worktreeId }),
      toolCatalogHash: this.hash(definitions),
      provider: selection.provider,
      model: selection.model,
      epochs: task.epochs,
      definitions,
      budget: {
        maxModelTurns: Math.min(100, Math.max(1, Math.ceil(task.budget.maxTokens / 4_096))),
        maxToolCalls: task.budget.maxToolCalls,
        maxToolRounds: Math.min(100, task.budget.maxToolCalls),
        maxRepairAttempts: 1,
        maxRuntimeMs: task.budget.maxRuntimeMs,
        maxOutputBytes: 16_777_216,
        maxToolResultBytes: 1_048_576,
      },
    });
    let sentSteering = 0;
    await this.dependencies.stream.follow(
      receipt.runId,
      runtime,
      {
        onEvent: async (event) => {
          this.observe(event, telemetry);
          const messages = steering();
          while (sentSteering < messages.length) {
            const message = messages[sentSteering];
            if (message === undefined) break;
            await this.dependencies.transport.steer(
              receipt.runId,
              {
                schemaVersion: '2.0',
                steeringId: `steering:${randomUUID()}`,
                runId: receipt.runId,
                sequence: sentSteering,
                idempotencyKey: `steering-key:${randomUUID()}`,
                message,
                epochs: task.epochs,
                receivedAt: new Date().toISOString(),
              },
              signal,
            );
            sentSteering += 1;
          }
        },
      },
      signal,
    );
    return {
      taskId: task.taskId,
      status: telemetry.status,
      changedPaths: [...telemetry.changedPaths],
      tokens: telemetry.tokens,
      toolCalls: telemetry.toolCalls,
      modelTurns: telemetry.modelTurns,
      artifacts: [...telemetry.artifacts],
      findings: telemetry.findings,
      ...(telemetry.blocker === undefined ? {} : { blocker: telemetry.blocker }),
      ...(telemetry.graph === undefined ? {} : { graph: telemetry.graph }),
    };
  }

  private allowedDefinitions(task: SubAgentTask): readonly ToolDefinition[] {
    const allowed = new Set(task.tools);
    return this.dependencies
      .definitions()
      .filter(
        (definition) =>
          allowed.has(definition.name) &&
          !/(?:elevat|publish)/iu.test(definition.name) &&
          !['runtime.agents', 'runtime.integration', 'runtime.flagship'].includes(definition.name),
      );
  }

  private modelSelection(task: SubAgentTask): {
    readonly provider: string;
    readonly model: string;
  } {
    const combined = task.modelPolicy.allowedModels.find((candidate) => candidate.includes('/'));
    if (combined !== undefined) {
      const separator = combined.indexOf('/');
      return { provider: combined.slice(0, separator), model: combined.slice(separator + 1) };
    }
    return {
      provider: task.modelPolicy.allowedProviders[0] ?? 'AUTO',
      model: task.modelPolicy.allowedModels[0] ?? 'AUTO',
    };
  }

  private observe(event: RuntimeEvent, telemetry: SubAgentTelemetry): void {
    if (event.type === 'tool.requested') telemetry.toolCalls += 1;
    const inputTokens = event.payload.inputTokens;
    const outputTokens = event.payload.outputTokens;
    if (typeof inputTokens === 'number') telemetry.tokens += inputTokens;
    if (typeof outputTokens === 'number') telemetry.tokens += outputTokens;
    const usage = event.payload.usage;
    if (usage !== null && typeof usage === 'object' && 'modelTurns' in usage) {
      const modelTurns = usage.modelTurns;
      if (typeof modelTurns === 'number')
        telemetry.modelTurns = Math.max(telemetry.modelTurns, modelTurns);
    }
    if (event.type === 'run.completed') telemetry.status = 'succeeded';
    if (event.type === 'run.cancelled') telemetry.status = 'cancelled';
    if (event.type === 'run.failed') {
      telemetry.status = 'failed';
      telemetry.blocker = describeSubAgentFailure(event.payload);
    }
  }

  private telemetry(): SubAgentTelemetry {
    return {
      changedPaths: new Set(),
      artifacts: new Set(),
      findings: [],
      tokens: 0,
      toolCalls: 0,
      modelTurns: 0,
      status: 'failed',
    };
  }

  private blocked(task: SubAgentTask, blocker: string): SubAgentOutcome {
    return {
      taskId: task.taskId,
      status: 'blocked',
      changedPaths: [],
      tokens: 0,
      toolCalls: 0,
      artifacts: [],
      findings: [],
      blocker,
    };
  }

  private hash(value: unknown): string {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  }
}

/** @internal Exported for direct policy-boundary regression coverage. */
export class ScopedSubAgentExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly task: SubAgentTask,
    private readonly delegate: RuntimeToolExecutorPort,
    private readonly telemetry: SubAgentTelemetry,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (!this.task.tools.includes(invocation.toolName)) throw new Error('Sub-agent tool is denied');
    if (/(?:push|publish|elevat)/iu.test(`${invocation.toolName}.${invocation.operation}`)) {
      throw new Error('Sub-agents cannot push, publish, or elevate');
    }
    if (
      invocation.toolName === 'workspace.git' &&
      ![
        'status',
        'diff',
        'log',
        'blame',
        'branches',
        'tags',
        'remotes',
        'worktrees',
        'conflicts',
        'submodules',
        'topology',
      ].includes(invocation.operation) &&
      !(
        this.task.role === 'integrator' &&
        ['stage', 'unstage', 'commit'].includes(invocation.operation)
      )
    ) {
      throw new Error('Sub-agent Git mutation must be performed by the integrator');
    }
    this.assertRoot(invocation);
    this.captureWrites(invocation);
    this.captureFindings(invocation);
    this.captureArtifact(invocation);
    const output = await this.delegate.execute(invocation, signal);
    this.capturePlanGraph(invocation, output);
    return output;
  }

  private assertRoot(invocation: ToolInvocation): void {
    this.assertBoundRoots(invocation.arguments);
  }

  private assertBoundRoots(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) this.assertBoundRoots(item);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (
        ['rootKey', 'cwdRootKey', 'targetWorktreeId'].includes(key) &&
        typeof child === 'string' &&
        child !== this.task.worktreeId
      ) {
        throw new Error('Sub-agent attempted to leave its worktree');
      }
      this.assertBoundRoots(child);
    }
  }

  /**
   * Collects what a reviewer sub-agent reported, from the call it made.
   *
   * Reviewer roles were enum labels with nothing behind them: a reviewer wrote
   * its conclusions into prose, so the parent could not count them, merge them
   * with another reviewer's, or decide whether they blocked. The findings are
   * in the invocation arguments, exactly as writes are, so they are captured
   * the same way and reach the parent on the outcome.
   *
   * A malformed report is dropped rather than failing the task. A reviewer that
   * found something real and described one finding badly should still deliver
   * the rest, and the tool call itself will report the validation error.
   */
  private captureFindings(invocation: ToolInvocation): void {
    if (invocation.toolName !== 'workspace.quality' || invocation.operation !== 'report') return;
    const parsed = findingsSchema.safeParse(invocation.arguments.findings);
    if (!parsed.success) return;
    for (const finding of parsed.data) this.telemetry.findings.push(finding);
  }

  private captureWrites(invocation: ToolInvocation): void {
    if (invocation.toolName !== 'workspace.files' || invocation.arguments.transaction === undefined)
      return;
    const transaction = fileTransactionSchema.parse(invocation.arguments.transaction);
    for (const operation of transaction.operations) {
      if (operation.rootKey !== this.task.worktreeId) {
        throw new Error('Sub-agent transaction targeted another worktree');
      }
      for (const path of [
        operation.path,
        'destination' in operation ? operation.destination : undefined,
      ]) {
        if (path === undefined) continue;
        if (!this.task.writeSet.includes(path))
          throw new Error('Sub-agent write is outside its lease');
        this.telemetry.changedPaths.add(path);
      }
    }
  }

  private captureArtifact(invocation: ToolInvocation): void {
    for (const candidate of [invocation.arguments.artifactPath, invocation.arguments.output]) {
      if (typeof candidate === 'string') this.addArtifact(candidate);
      if (candidate !== null && typeof candidate === 'object' && 'path' in candidate) {
        const path = candidate.path;
        if (typeof path === 'string') this.addArtifact(path);
      }
    }
  }

  // Evidence references are bounded min(1).max(2000) by the flagship snapshot
  // schema. A sub-agent controls these strings, so an empty or oversized one
  // would otherwise throw during checkpoint persistence and discard the run.
  private addArtifact(candidate: string): void {
    const artifact = candidate.trim();
    if (artifact.length > 0 && artifact.length <= 2_000) this.telemetry.artifacts.add(artifact);
  }

  private capturePlanGraph(invocation: ToolInvocation, output: RuntimeToolExecutionOutput): void {
    if (invocation.toolName !== 'workspace.planning' || invocation.operation !== 'validate') return;
    const graph = subAgentGraphSchema.safeParse(output.structured?.graph);
    if (graph.success) this.telemetry.graph = graph.data;
  }
}

/** @internal Exported for direct policy-boundary regression coverage. */
export class ScopedSubAgentPolicy implements RuntimeToolPolicyPort {
  constructor(
    private readonly task: SubAgentTask,
    private readonly delegate: RuntimeToolPolicyPort,
  ) {}

  async evaluate(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolPolicyDecision> {
    if (this.risk(invocation) > this.ceiling()) {
      return { decision: 'deny', code: 'SUB_AGENT_RISK_CEILING', message: 'Risk ceiling exceeded' };
    }
    return this.delegate.evaluate(invocation, signal);
  }

  private ceiling(): number {
    return { R0: 0, R1: 1, R2: 2, R3: 3 }[this.task.riskCeiling];
  }

  private risk(invocation: ToolInvocation): number {
    const identity = `${invocation.toolName}.${invocation.operation}`;
    if (/(?:delete|remove|push|publish|elevat|migration-apply|compose-down)/iu.test(identity))
      return 4;
    if (
      /(?:create|update|patch|rename|copy|mkdir|artifact|commit|stage|merge|rebase|cherry-pick|revert|build|pull|run|exec|start|stop|restart)/iu.test(
        identity,
      )
    )
      return 3;
    if (/(?:browser|process|container|database|command|network)/iu.test(identity)) return 2;
    return 0;
  }
}
