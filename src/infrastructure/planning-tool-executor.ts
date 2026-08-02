import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  implementationPlanSchema,
  issuePayloads,
  renderImplementationPlanMarkdown,
} from '../core/implementation-plan';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
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
    'Validate and export evidence-backed implementation plans without granting execution.',
  operations: ['validate', 'render-markdown', 'render-json', 'export', 'issue-payloads'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.planning,
};

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

export class PlanningToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly files: FileTransactionService) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== planningToolDefinition.name)
      throw new Error('Unknown planning tool');
    const plan = implementationPlanSchema.parse(invocation.arguments.plan);
    if (invocation.operation === 'validate') return { structured: { plan, valid: true } };
    if (invocation.operation === 'render-markdown') {
      return { structured: { content: renderImplementationPlanMarkdown(plan) } };
    }
    if (invocation.operation === 'render-json') {
      return { structured: { content: `${JSON.stringify(plan, undefined, 2)}\n` } };
    }
    if (invocation.operation === 'issue-payloads') {
      return { structured: { payloads: issuePayloads(plan), published: false } };
    }
    if (invocation.operation !== 'export') throw new Error('Unknown planning operation');
    const output = exportSchema.parse(invocation.arguments.output);
    const content =
      output.format === 'markdown'
        ? renderImplementationPlanMarkdown(plan)
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
    return { structured: { receipt, executionPermissionGranted: false } };
  }
}
