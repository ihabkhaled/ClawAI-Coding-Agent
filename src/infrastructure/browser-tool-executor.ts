import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { BrowserControllerService } from '../services/browser-controller-service';
import type { BrowserObservationUploadPort } from '../services/browser-observation-upload.types';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';
import type { ServerReadinessService } from '../services/server-readiness-service';

export const browserToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.browser',
  version: '2.0.0',
  description: 'Control an isolated visible browser and collect bounded, hashed evidence.',
  operations: [
    'launch',
    'close',
    'new-context',
    'close-context',
    'new-tab',
    'close-tab',
    'navigate',
    'snapshot',
    'locate',
    'click',
    'fill',
    'select',
    'keyboard',
    'hover',
    'drag',
    'upload',
    'download',
    'screenshot',
    'pdf',
    'console',
    'network',
    'storage',
    'trace-start',
    'trace-stop',
    'video',
    'accessibility',
    'measure-layout',
    'takeover',
    'return-control',
    'click-at',
    'type-text',
    'scroll',
    'observe',
    'wait-ready',
  ],
  riskClasses: ['browser', 'network'],
  targetIds: ['target:browser'],
  inputSchema: runtimeToolInputSchemas.browser,
};

export class BrowserToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly controller: BrowserControllerService,
    private readonly readiness: ServerReadinessService,
    // F030: absent in hosts that cannot upload; `observe` then returns evidence only.
    private readonly observations?: BrowserObservationUploadPort,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== browserToolDefinition.name) throw new Error('Unknown browser tool');
    if (invocation.operation === 'wait-ready') {
      return {
        structured: {
          receipt: await this.readiness.wait(invocation.arguments, invocation.runId, signal),
        },
      };
    }
    const result = await this.controller.execute(
      { ...invocation.arguments, operation: invocation.operation },
      signal,
    );
    const structured = { evidence: result.evidence, result: result.structured };
    if (invocation.operation !== 'observe' || this.observations === undefined)
      return { structured };
    const fileId = await this.observations.upload(result.evidence, signal);
    return fileId === undefined ? { structured } : { structured, fileIds: [fileId] };
  }
}
