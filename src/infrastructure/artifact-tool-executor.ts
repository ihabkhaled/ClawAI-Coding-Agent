import { z } from 'zod';

import { prepareArtifact } from '../core/artifact-publication';
import { isContainedRelativePath } from '../core/plugin-path';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ArtifactPublisherPort } from '../backend/artifact-client';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { NotebookReaderPort } from '../services/notebook-tool.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const artifactToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.artifact',
  version: '1.0.0',
  description:
    'Share a workspace text file as a hosted page. prepare scrubs the file of credentials and ' +
    'returns the exact preview that would be uploaded, sending nothing. publish scrubs again ' +
    'and uploads it after approval; a credential that survives scrubbing blocks the upload.',
  operations: ['prepare', 'publish'],
  riskClasses: ['inspect', 'network', 'publish'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.artifact,
};

const inputSchema = z.object({
  rootKey: z.string().min(1).max(100),
  path: z.string().min(1).max(4_096),
  title: z.string().min(1).max(200).optional(),
});

/**
 * Scrub-before-publish for a workspace file.
 *
 * `prepare` and `publish` share one code path up to the upload, so what the
 * model previewed is what is scrubbed again and sent: there is no second
 * pipeline in which a file could differ between review and upload.
 */
export class ArtifactToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly reader: NotebookReaderPort,
    private readonly publisher: ArtifactPublisherPort,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== artifactToolDefinition.name) {
      throw new Error('Unknown artifact tool');
    }
    if (invocation.operation !== 'prepare' && invocation.operation !== 'publish') {
      throw new Error('Unknown artifact operation');
    }
    const input = inputSchema.parse(invocation.arguments);
    // `..` or an absolute path would upload a file the workspace never held.
    if (!isContainedRelativePath(input.path.replaceAll('\\', '/'))) {
      throw new Error('Artifact path must stay inside the workspace');
    }
    const prepared = prepareArtifact({
      path: input.path,
      content: await this.reader.read(input.rootKey, input.path),
    });
    if (prepared.status === 'blocked') return { structured: { ...prepared } };
    const { content, ...summary } = prepared;
    if (invocation.operation === 'prepare') {
      return { structured: { ...summary, uploaded: false } };
    }
    const outcome = await this.publisher.publish(
      {
        filename: prepared.filename,
        mimeType: prepared.mimeType,
        content,
        sha256: prepared.sha256,
        title: input.title,
      },
      signal,
    );
    return { structured: { ...summary, ...outcome, uploaded: outcome.status === 'published' } };
  }
}
