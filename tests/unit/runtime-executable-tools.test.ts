import { describe, expect, it } from 'vitest';

import { executableToolDefinitions } from '../../src/core/runtime/runtime-executable-tools';

import type { CapabilityManifest } from '../../src/core/runtime/capability-manifest';
import type { ToolDefinition } from '../../src/core/runtime/runtime-tool-contracts';

const definition = (name: string): ToolDefinition =>
  ({
    schemaVersion: '2.0',
    name,
    version: '2.0.0',
    description: name,
    operations: ['run'],
    riskClasses: ['inspect'],
    targetIds: ['target:workspace'],
    inputSchema: {},
  }) as unknown as ToolDefinition;

const manifest = (...capabilities: readonly string[][]): CapabilityManifest =>
  ({
    targets: capabilities.map((entries, index) => ({
      id: `target:${String(index)}`,
      capabilities: entries,
    })),
  }) as unknown as CapabilityManifest;

describe('executableToolDefinitions', () => {
  it('offers only what a target advertises', () => {
    const offered = executableToolDefinitions(
      [definition('workspace.files'), definition('workspace.git')],
      manifest(['workspace.files']),
    );
    expect(offered.map(({ name }) => name)).toEqual(['workspace.files']);
  });

  it('offers nothing when the target advertises nothing', () => {
    // This is the untrusted-workspace case. Offering the full list here is
    // what made the model try four tools and fail four times.
    expect(executableToolDefinitions([definition('workspace.git')], manifest([]))).toEqual([]);
  });

  it('unions capabilities across targets', () => {
    // Container, database and browser each register as their own target with a
    // single capability; a tool one of them provides is still executable.
    const offered = executableToolDefinitions(
      [definition('workspace.files'), definition('workspace.browser')],
      manifest(['workspace.files'], ['workspace.browser']),
    );
    expect(offered.map(({ name }) => name)).toEqual(['workspace.files', 'workspace.browser']);
  });

  it('preserves the order the router registered', () => {
    const offered = executableToolDefinitions(
      [definition('a'), definition('b'), definition('c')],
      manifest(['c', 'a', 'b']),
    );
    expect(offered.map(({ name }) => name)).toEqual(['a', 'b', 'c']);
  });
});
