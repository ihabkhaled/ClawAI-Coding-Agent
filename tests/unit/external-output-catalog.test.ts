import { describe, expect, it } from 'vitest';

import { describeExternalOutputRoots } from '../../src/core/runtime/external-output-catalog';

import type { ExternalOutputGrant } from '../../src/core/external-output-grants';
import type { ToolDefinition } from '../../src/core/runtime/runtime-tool-contracts';

const files: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.files',
  version: '2.0.0',
  description: 'Bounded workspace discovery.',
  operations: ['list', 'create'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: { type: 'object', additionalProperties: false },
};
const command: ToolDefinition = { ...files, name: 'workspace.command', operations: ['run'] };

const grant: ExternalOutputGrant = {
  rootKey: 'output-2f1c9a3e',
  label: 'ClawAI',
  uri: 'file:///d%3A/Freelance/Packs/ClawAI',
};

describe('describeExternalOutputRoots', () => {
  it('names every approved output folder so the model can address it', () => {
    // The adapter has always resolved these root keys; the catalog never
    // mentioned them, so the model reported it could not write outside the
    // workspace even when a grant existed.
    const [described] = describeExternalOutputRoots([files], [grant]);

    expect(described?.description).toContain('"output-2f1c9a3e" (ClawAI)');
    expect(described?.description).toContain('Bounded workspace discovery.');
    expect(described?.description).toContain('still requires approval');
  });

  it('tells the model what to say when nothing outside the workspace is approved', () => {
    const [described] = describeExternalOutputRoots([files], []);

    expect(described?.description).toContain('No folder outside the workspace is approved');
    expect(described?.description).toContain('Output folders');
  });

  it('lists every grant', () => {
    const second: ExternalOutputGrant = {
      rootKey: 'output-9b0d',
      label: 'Reports',
      uri: 'file:///d%3A/Reports',
    };
    const [described] = describeExternalOutputRoots([files], [grant, second]);

    expect(described?.description).toContain('"output-2f1c9a3e" (ClawAI)');
    expect(described?.description).toContain('"output-9b0d" (Reports)');
  });

  it('leaves every other tool untouched', () => {
    const described = describeExternalOutputRoots([files, command], [grant]);

    expect(described[1]).toEqual(command);
    expect(described[1]?.description).toBe('Bounded workspace discovery.');
  });
});
