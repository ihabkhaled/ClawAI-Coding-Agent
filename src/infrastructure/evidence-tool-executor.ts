import * as vscode from 'vscode';
import { z } from 'zod';

import { renderEvidenceMarkdown, verifyEvidenceBundle } from '../core/evidence-bundle';
import { contentHash } from '../core/file-transaction';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { EvidenceBundleService } from '../services/evidence-bundle-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const evidenceToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'runtime.evidence',
  version: '2.0.0',
  description: 'Build, verify, render, and export sanitized deterministic runtime evidence.',
  operations: ['build', 'verify', 'render-markdown', 'export-markdown', 'export-zip'],
  riskClasses: ['inspect', 'workspace-write'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.evidence,
};

const outputSchema = z
  .object({
    rootKey: z.string().min(1).max(200),
    path: z.string().min(1).max(4_096),
  })
  .strict();

export class EvidenceToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly evidence: EvidenceBundleService,
    private readonly files: VscodeFileTransactionAdapter,
  ) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== evidenceToolDefinition.name)
      throw new Error('Unknown evidence tool');
    if (invocation.operation === 'build') {
      return { structured: { bundle: this.evidence.build(invocation.arguments.input) } };
    }
    const bundle = verifyEvidenceBundle(invocation.arguments.bundle);
    if (invocation.operation === 'verify') {
      return { structured: { valid: true, rootHash: bundle.rootHash } };
    }
    const markdown = renderEvidenceMarkdown(bundle);
    if (invocation.operation === 'render-markdown') return { structured: { markdown } };
    if (invocation.operation !== 'export-markdown' && invocation.operation !== 'export-zip') {
      throw new Error('Unknown evidence operation');
    }
    const output = outputSchema.parse(invocation.arguments.output);
    const uri = await this.files.uriFor(output.rootKey, output.path, 'create');
    const bytes =
      invocation.operation === 'export-zip'
        ? (await this.evidence.archiveBundle(bundle, markdown)).bytes
        : new TextEncoder().encode(markdown);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return {
      structured: {
        artifact: output.path,
        bytes: bytes.byteLength,
        hash: contentHash(bytes),
        format: invocation.operation === 'export-zip' ? 'zip' : 'markdown',
      },
    };
  }
}
