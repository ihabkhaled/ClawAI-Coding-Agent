import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { agentTaskListSchema } from '../core/agent-tasks';
import {
  implementationPlanSchema,
  issuePayloads,
  renderImplementationPlanMarkdown,
} from '../core/implementation-plan';
import { subAgentGraphSchema } from '../core/multi-agent-dag';
import {
  assertPlanRevision,
  describePlanRevisionChange,
  embedPlanRevision,
  parsePlanDocument,
  planRevisionHash,
} from '../core/plan-revision';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ImplementationPlan } from '../core/implementation-plan';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { AgentTaskService } from '../services/agent-task-service';
import type { FileTransactionService } from '../services/file-transaction-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const planningToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.planning',
  version: '2.0.0',
  description:
    'Validate and export evidence-backed implementation plans without granting execution. ' +
    'export writes the plan and binds a revision hash; adopt reads a document the user has ' +
    'edited back and rebinds it, so later operations can name the revision they read. ' +
    'set-tasks records the short task list you are working through and shows it to the user: ' +
    'pass tasks as an array of {id, title, status (pending|in-progress|blocked|done), note}. ' +
    'Send the whole list every time, keep at most one in-progress, and update it as you go. ' +
    'list-tasks returns the current list. This is run state, not the implementation plan.',
  operations: [
    'validate',
    'render-markdown',
    'render-json',
    'export',
    'adopt',
    'issue-payloads',
    'set-tasks',
    'list-tasks',
  ],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.planning,
};

const setTasksSchema = z.object({ tasks: agentTaskListSchema }).strip();

const adoptSchema = z.object({ document: z.string().min(1).max(2_000_000) }).strip();

const revisionSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/u)
  .optional();

const exportSchema = z
  .object({
    rootKey: z.string().min(1).max(100),
    path: z.string().min(1).max(4_096),
    format: z.enum(['markdown', 'json']),
    beforeHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .nullable()
      .default(null),
  })
  .strict();

/** The operations that only read a plan, answered the same way for every caller. */
function planOperation(
  operation: string,
  plan: ImplementationPlan,
): RuntimeToolExecutionOutput | undefined {
  if (operation === 'validate') return { structured: { plan, valid: true } };
  if (operation === 'render-markdown') {
    return { structured: { content: renderImplementationPlanMarkdown(plan) } };
  }
  if (operation === 'render-json') {
    return { structured: { content: `${JSON.stringify(plan, undefined, 2)}\n` } };
  }
  if (operation === 'issue-payloads') {
    return { structured: { payloads: issuePayloads(plan), published: false } };
  }
  return undefined;
}

export class PlanningToolExecutor implements RuntimeToolExecutorPort {
  /** The revision the last export or adopt bound work to, if any. */
  private boundRevision: string | undefined;

  constructor(
    private readonly files: FileTransactionService,
    private readonly tasks: AgentTaskService,
  ) {}

  private taskOperation(invocation: ToolInvocation): RuntimeToolExecutionOutput | undefined {
    if (invocation.operation === 'set-tasks') {
      const { tasks } = setTasksSchema.parse(invocation.arguments);
      return { structured: { ...this.tasks.replace(tasks) } };
    }
    if (invocation.operation === 'list-tasks') return { structured: { ...this.tasks.current() } };
    return undefined;
  }

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== planningToolDefinition.name)
      throw new Error('Unknown planning tool');
    // Task operations carry no plan, so they are answered before the schema
    // that requires one.
    const taskOutput = this.taskOperation(invocation);
    if (taskOutput !== undefined) return taskOutput;
    // Adopting carries a document rather than a plan: the plan is what comes
    // out of it.
    if (invocation.operation === 'adopt') return this.adopt(invocation);
    assertPlanRevision(this.boundRevision, revisionSchema.parse(invocation.arguments.revision));
    if (invocation.operation === 'validate') {
      const graph = subAgentGraphSchema.safeParse(invocation.arguments.plan);
      if (graph.success) return { structured: { graph: graph.data, valid: true } };
    }
    const plan = implementationPlanSchema.parse(invocation.arguments.plan);
    const planOutput = planOperation(invocation.operation, plan);
    if (planOutput !== undefined) return planOutput;
    if (invocation.operation !== 'export') throw new Error('Unknown planning operation');
    const output = exportSchema.parse(invocation.arguments.output);
    const content =
      output.format === 'markdown'
        ? embedPlanRevision(renderImplementationPlanMarkdown(plan), plan)
        : `${JSON.stringify(plan, undefined, 2)}\n`;
    const preview = await this.files.preview(
      {
        transactionId: `plan-export:${randomUUID()}`,
        summary: `Export implementation plan ${plan.planId}`,
        operations: [
          {
            kind: output.beforeHash === null ? 'create' : 'update',
            rootKey: output.rootKey,
            path: output.path,
            content,
            beforeHash: output.beforeHash,
          },
        ],
      },
      signal,
    );
    const receipt = await this.files.apply(preview, signal);
    this.boundRevision = planRevisionHash(plan);
    return {
      structured: { receipt, revision: this.boundRevision, executionPermissionGranted: false },
    };
  }

  /**
   * Reads the user's edits back out of an exported plan document.
   *
   * The document is the source of truth once it has been handed to a person:
   * whatever they left in it is the plan, and the revision it hashes to
   * becomes the one later operations must name.
   */
  private adopt(invocation: ToolInvocation): RuntimeToolExecutionOutput {
    const { document } = adoptSchema.parse(invocation.arguments);
    const adopted = parsePlanDocument(document);
    const change = describePlanRevisionChange(this.boundRevision, adopted.revision);
    this.boundRevision = adopted.revision;
    return {
      structured: {
        plan: adopted.plan,
        revision: adopted.revision,
        change,
        executionPermissionGranted: false,
      },
    };
  }
}
