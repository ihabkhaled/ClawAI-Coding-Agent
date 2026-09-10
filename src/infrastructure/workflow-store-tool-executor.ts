import { z } from 'zod';

import { subAgentGraphSchema } from '../core/multi-agent-dag';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { prepareWorkflowForRun, toSavedWorkflow } from '../core/saved-workflow';

import type { WorkflowStorePort } from './workflow-store-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const saveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
  graph: subAgentGraphSchema,
});

const loadSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const workflowStoreToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.workflows',
  version: '2.0.0',
  description:
    'Save an agent graph so a later run can use it again. save takes name, description and the ' +
    'graph you would pass to runtime.agents. list returns what this workspace has saved. load ' +
    'takes name and returns the graph ready to run — its epochs are refreshed to the current ' +
    'ones, so a saved workflow is a shape to re-run and never a permission to reuse. Save a ' +
    'graph that worked, not one you are still shaping.',
  operations: ['save', 'list', 'load'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.workflows,
};

/**
 * Saving and re-running an agent-defined graph.
 *
 * Workflows were seven prompt templates behind a command: fixed, written by
 * this repository, and unable to describe the work anyone actually did twice.
 * A graph the model built and a person watched succeed is a better workflow
 * than any template, and until now it could not be kept.
 *
 * Loading refreshes the epochs rather than replaying the stored ones. An epoch
 * names the generation of account, workspace, target and policy a call was
 * authorised against; replaying a saved one would run today's work against an
 * authorisation nobody re-granted.
 */
export class WorkflowStoreToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly store: WorkflowStorePort,
    private readonly epochs: () => ToolInvocation['epochs'],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== workflowStoreToolDefinition.name) {
      throw new Error('Unknown workflow tool');
    }
    if (invocation.operation === 'save') return this.save(invocation.arguments);
    if (invocation.operation === 'list') return this.list();
    if (invocation.operation === 'load') return this.load(invocation.arguments);
    throw new Error('Unknown workflow operation');
  }

  private async save(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { name, description, graph } = saveSchema.parse(args);
    const workflow = toSavedWorkflow(name, description, graph, this.now());
    await this.store.write(workflow);
    return { structured: { saved: true, name: workflow.name, tasks: graph.tasks.length } };
  }

  private async list(): Promise<RuntimeToolExecutionOutput> {
    const saved = await this.store.list();
    return {
      structured: {
        workflows: saved.map((workflow) => ({
          name: workflow.name,
          description: workflow.description,
          savedAt: workflow.savedAt,
          tasks: workflow.graph.tasks.length,
        })),
      },
    };
  }

  private async load(args: unknown): Promise<RuntimeToolExecutionOutput> {
    const { name } = loadSchema.parse(args);
    const saved = await this.store.read(name);
    if (saved === undefined) {
      // Reported, not thrown. Asking for a workflow that is not there is a
      // reasonable thing to do after listing nothing, and it should cost one
      // result rather than the run.
      return { structured: { loaded: false, reason: 'not-found' } };
    }
    return {
      structured: {
        loaded: true,
        description: saved.description,
        graph: prepareWorkflowForRun(saved, this.epochs()),
      },
    };
  }
}
