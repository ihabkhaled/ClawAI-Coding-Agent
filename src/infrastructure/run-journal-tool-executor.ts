import { z } from 'zod';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { RunJournalService } from '../services/run-journal-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const runJournalToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.journal',
  version: '2.0.0',
  description: 'Persist, inspect, safely export, search, or delete an encrypted runtime journal.',
  operations: ['save', 'load', 'search', 'safe-export', 'delete'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', additionalProperties: true },
};

const runIdSchema = z.string().min(8).max(200);

export class RunJournalToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly journals: RunJournalService) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== runJournalToolDefinition.name)
      throw new Error('Unknown journal tool');
    if (invocation.operation === 'save') {
      await this.journals.save(invocation.arguments.journal);
      return { structured: { saved: true } };
    }
    if (invocation.operation === 'search') {
      const query = z.string().max(500).default('').parse(invocation.arguments.query);
      return { structured: { journals: await this.journals.search(query) } };
    }
    const runId = runIdSchema.parse(invocation.arguments.runId);
    if (invocation.operation === 'load') {
      return { structured: { journal: (await this.journals.load(runId)) ?? null } };
    }
    if (invocation.operation === 'safe-export') {
      return { structured: { journal: await this.journals.safeExport(runId) } };
    }
    if (invocation.operation === 'delete') {
      await this.journals.delete(runId);
      return { structured: { deleted: true, runId } };
    }
    throw new Error('Unknown journal operation');
  }
}
