import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export interface SafeRuntimeFixture {
  readonly documentCount: number;
  readonly workspaceLabel: string;
}

export const safeRuntimeFixtureDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  description: 'Return a deterministic read-only fixture workspace summary.',
  inputSchema: {
    additionalProperties: false,
    properties: {},
    required: [],
    type: 'object',
  },
  name: 'fixture.workspace-summary',
  operations: ['read'],
  riskClasses: ['inspect'],
  targetIds: ['target:fixture'],
  version: '1.0',
};

/** Prevents fixture output from representing an implausibly large workspace. */
const MAX_FIXTURE_DOCUMENT_COUNT = 1_000_000;

function validFixture(fixture: SafeRuntimeFixture): void {
  if (
    !Number.isSafeInteger(fixture.documentCount) ||
    fixture.documentCount < 0 ||
    fixture.documentCount > MAX_FIXTURE_DOCUMENT_COUNT
  ) {
    throw new Error('Fixture document count must be a bounded nonnegative safe integer');
  }
  if (fixture.workspaceLabel.trim().length === 0 || fixture.workspaceLabel.length > 200) {
    throw new Error('Fixture workspace label must be bounded and non-empty');
  }
}

function isFixtureInvocation(invocation: ToolInvocation): boolean {
  return (
    invocation.toolName === safeRuntimeFixtureDefinition.name &&
    invocation.toolVersion === safeRuntimeFixtureDefinition.version &&
    invocation.operation === 'read' &&
    invocation.targetId === 'target:fixture' &&
    Object.keys(invocation.arguments).length === 0
  );
}

export class SafeRuntimeFixtureExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly fixture: SafeRuntimeFixture) {
    validFixture(fixture);
  }

  execute(invocation: ToolInvocation, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput> {
    if (signal?.aborted) {
      return Promise.reject(new Error('Safe runtime fixture was cancelled'));
    }
    if (!isFixtureInvocation(invocation)) {
      return Promise.reject(
        new Error('Safe runtime fixture accepts only its exact read-only invocation'),
      );
    }
    return Promise.resolve({
      modelText: 'Fixture workspace summary is ready.',
      structured: {
        documentCount: this.fixture.documentCount,
        workspaceLabel: this.fixture.workspaceLabel,
      },
    });
  }
}
