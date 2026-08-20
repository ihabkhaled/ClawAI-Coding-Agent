import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({}));

import { createRuntimeInvocationRegistry } from '../../src/core/runtime/runtime-invocation-registry';
import { browserToolDefinition } from '../../src/infrastructure/browser-tool-executor';
import { containerToolDefinition } from '../../src/infrastructure/container-tool-executor';
import { databaseToolDefinition } from '../../src/infrastructure/database-tool-executor';
import { developmentServiceToolDefinition } from '../../src/infrastructure/development-service-tool-executor';
import { elevationToolDefinition } from '../../src/infrastructure/elevation-tool-executor';
import { evidenceToolDefinition } from '../../src/infrastructure/evidence-tool-executor';
import { flagshipToolDefinition } from '../../src/infrastructure/flagship-tool-executor';
import { gitToolDefinition } from '../../src/infrastructure/git-tool-executor';
import { integrationToolDefinition } from '../../src/infrastructure/integration-tool-executor';
import { intelligenceToolDefinition } from '../../src/infrastructure/intelligence-tool-executor';
import { planningToolDefinition } from '../../src/infrastructure/planning-tool-executor';
import { processSupervisorToolDefinition } from '../../src/infrastructure/process-supervisor-tool-executor';
import { qualityToolDefinition } from '../../src/infrastructure/quality-tool-executor';
import { runJournalToolDefinition } from '../../src/infrastructure/run-journal-tool-executor';
import { structuredCommandToolDefinition } from '../../src/infrastructure/structured-command-tool-executor';
import { subAgentToolDefinition } from '../../src/infrastructure/sub-agent-tool-executor';
import { workspaceFilesystemToolDefinition } from '../../src/infrastructure/vscode-filesystem-tool-executor';

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
      elevationToolDefinition,
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
    for (const definition of definitions.filter(({ name }) =>
      ['runtime.agents', 'runtime.integration', 'runtime.flagship', 'runtime.elevation'].includes(
        name,
      ),
    )) {
      expect(definition.inputSchema.required).toHaveLength(1);
      expect(definition.inputSchema.properties).toBeDefined();
    }
  });

  it('advertises the exact structured-command contract the executor enforces', () => {
    expect(structuredCommandToolDefinition.inputSchema.required).toEqual([
      'executable',
      'cwdRootKey',
      'timeoutMs',
      'outputLimitBytes',
      'expectedEffect',
    ]);
    expect(structuredCommandToolDefinition.inputSchema.properties).not.toHaveProperty('targetId');
    expect(structuredCommandToolDefinition.inputSchema.properties).toEqual(
      expect.objectContaining({
        executable: { type: 'string', minLength: 1, maxLength: 4_096 },
        arguments: {
          type: 'array',
          items: { type: 'string', maxLength: 32_768 },
          maxItems: 1_000,
        },
        cwdRootKey: { type: 'string', minLength: 1, maxLength: 100 },
        cwd: { type: 'string', minLength: 1, maxLength: 4_096 },
        timeoutMs: { type: 'integer', minimum: 100, maximum: 7_200_000 },
        outputLimitBytes: { type: 'integer', minimum: 1_024, maximum: 16_777_216 },
        expectedEffect: {
          type: 'string',
          enum: ['read', 'build', 'test', 'local-mutation', 'network', 'install'],
        },
      }),
    );
    expect(structuredCommandToolDefinition.description).toContain('expectedEffect');
    expect(structuredCommandToolDefinition.description).toContain('"cwd":"."');
  });

  it('advertises filesystem discovery limits that fit the Runtime V2 result envelope', () => {
    expect(workspaceFilesystemToolDefinition.inputSchema.properties).toEqual(
      expect.objectContaining({
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
      }),
    );
    expect(workspaceFilesystemToolDefinition.description).toContain('at most 100 results');
  });

  it('tells the model to stop redundant discovery and send parser-safe mutations', () => {
    expect(workspaceFilesystemToolDefinition.description).toContain(
      'do not rediscover unchanged files',
    );
    expect(workspaceFilesystemToolDefinition.description).toContain('one small mutation per call');
    expect(workspaceFilesystemToolDefinition.description).toContain('source containing braces');
    expect(workspaceFilesystemToolDefinition.description).toContain('contentBase64');
    expect(workspaceFilesystemToolDefinition.description.length).toBeLessThanOrEqual(2_000);
  });
});
