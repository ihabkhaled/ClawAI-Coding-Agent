import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { workflowTemplateSchema } from '../../src/core/workflow-template';

const root = join(__dirname, '..', '..');

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, relativePath), 'utf8')) as Record<string, unknown>;
}

/**
 * The editor schema for `.clawai/workflows/*.json` is hand-authored like the
 * other `.clawai` schemas. It is turned into a real validator here with Zod's
 * `fromJSONSchema`, so the test proves what the file accepts and rejects
 * rather than only that its keys match.
 */
const schema = readJson('schemas/clawai-workflow.schema.json');
const validator = z.fromJSONSchema(schema);
const template = {
  kind: 'template',
  name: 'Release notes',
  description: 'Draft release notes',
  instruction: 'Summarise the changes.',
  steps: ['Read the log'],
  acceptanceChecks: ['Every commit is listed'],
  requestPrompt: 'Which version?',
};

describe('clawai-workflow.schema.json', () => {
  it('accepts a valid template, which the runtime schema also accepts', () => {
    expect(validator.safeParse(template).success).toBe(true);
    expect(workflowTemplateSchema.safeParse(template).success).toBe(true);
  });

  it.each([
    ['an empty instruction', { ...template, instruction: '' }],
    ['a missing instruction', { ...template, instruction: undefined }],
    ['an unknown key', { ...template, model: 'gpt' }],
    ['a wrong kind', { ...template, kind: 'graph' }],
    ['too many steps', { ...template, steps: Array.from({ length: 21 }, () => 'step') }],
  ])('rejects a template with %s', (_label, candidate) => {
    const cleaned: unknown = JSON.parse(JSON.stringify(candidate));

    expect(validator.safeParse(cleaned).success).toBe(false);
    expect(workflowTemplateSchema.safeParse(cleaned).success).toBe(false);
  });

  it('still accepts a saved graph file, which shares the folder', () => {
    const graph = { name: 'g', description: 'd', savedAt: '2026-09-30', graph: { tasks: [] } };

    expect(validator.safeParse(graph).success).toBe(true);
  });

  it('offers exactly the keys workflowTemplateSchema accepts', () => {
    const definitions = schema.definitions as Record<string, { properties: object }>;

    expect(Object.keys(definitions.template?.properties ?? {}).sort()).toEqual(
      Object.keys(workflowTemplateSchema.shape).sort(),
    );
  });

  it('is wired to .clawai/workflows through contributes.jsonValidation', () => {
    const contributes = readJson('package.json').contributes as {
      jsonValidation: { fileMatch: string; url: string }[];
    };

    expect(contributes.jsonValidation).toContainEqual({
      fileMatch: '/.clawai/workflows/*.json',
      url: './schemas/clawai-workflow.schema.json',
    });
  });
});
