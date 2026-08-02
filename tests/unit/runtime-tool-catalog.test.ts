import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { browserToolDefinition } from '../../src/infrastructure/browser-tool-executor';
import { containerToolDefinition } from '../../src/infrastructure/container-tool-executor';
import { databaseToolDefinition } from '../../src/infrastructure/database-tool-executor';
import { developmentServiceToolDefinition } from '../../src/infrastructure/development-service-tool-executor';
import { evidenceToolDefinition } from '../../src/infrastructure/evidence-tool-executor';
import { flagshipToolDefinition } from '../../src/infrastructure/flagship-tool-executor';
import { gitToolDefinition } from '../../src/infrastructure/git-tool-executor';
import { intelligenceToolDefinition } from '../../src/infrastructure/intelligence-tool-executor';
import { integrationToolDefinition } from '../../src/infrastructure/integration-tool-executor';
import { planningToolDefinition } from '../../src/infrastructure/planning-tool-executor';
import { processSupervisorToolDefinition } from '../../src/infrastructure/process-supervisor-tool-executor';
import { qualityToolDefinition } from '../../src/infrastructure/quality-tool-executor';
import { runJournalToolDefinition } from '../../src/infrastructure/run-journal-tool-executor';
import { structuredCommandToolDefinition } from '../../src/infrastructure/structured-command-tool-executor';
import { subAgentToolDefinition } from '../../src/infrastructure/sub-agent-tool-executor';
import { workspaceFilesystemToolDefinition } from '../../src/infrastructure/vscode-filesystem-tool-executor';
import { createRuntimeInvocationRegistry } from '../../src/core/runtime/runtime-invocation-registry';

describe('production Runtime V2 tool catalog', () => {
  it('uses bounded strict top-level schemas for every registered executor', () => {
    const definitions = [
      workspaceFilesystemToolDefinition,
      gitToolDefinition,
      structuredCommandToolDefinition,
      processSupervisorToolDefinition,
      containerToolDefinition,
      browserToolDefinition,
      databaseToolDefinition,
      qualityToolDefinition,
      intelligenceToolDefinition,
      planningToolDefinition,
      runJournalToolDefinition,
      evidenceToolDefinition,
      developmentServiceToolDefinition,
      subAgentToolDefinition,
      integrationToolDefinition,
      flagshipToolDefinition,
    ];

    expect(() =>
      createRuntimeInvocationRegistry({
        definitions,
        epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
        runId: 'runtime:catalog-test',
        turnId: 'turn:catalog-test',
      }),
    ).not.toThrow();
    expect(
      definitions.every((definition) => definition.inputSchema.additionalProperties === false),
    ).toBe(true);
  });
});
