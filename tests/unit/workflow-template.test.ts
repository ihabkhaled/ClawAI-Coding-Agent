import { describe, expect, it } from 'vitest';

import { savedWorkflowSchema } from '../../src/core/saved-workflow';
import {
  workflowTemplateRunPrompt,
  workflowTemplateSchema,
} from '../../src/core/workflow-template';
import { savedWorkflowPicks } from '../../src/services/saved-workflow-picks';
import { flagshipImplementationGraph } from '../helpers/flagship-stage';

const template = workflowTemplateSchema.parse({
  kind: 'template',
  name: 'Release notes',
  description: 'Draft release notes from the last tag',
  instruction: 'Summarise every change since the last tag for users.',
  steps: ['Read git log since the last tag', 'Group changes by area'],
  acceptanceChecks: ['Every commit is accounted for'],
  requestPrompt: 'Which version?',
});

describe('workflow templates', () => {
  it('parses a user-defined template and defaults its optional lists', () => {
    const minimal = workflowTemplateSchema.parse({
      kind: 'template',
      name: 'Lint sweep',
      description: 'Fix lint warnings',
      instruction: 'Fix every lint warning without changing behaviour.',
    });
    expect(minimal.steps).toEqual([]);
    expect(minimal.acceptanceChecks).toEqual([]);
    expect(minimal.requestPrompt).toBeUndefined();
  });

  it('refuses unknown fields, empty instructions and oversized step lists', () => {
    const base = { kind: 'template', name: 'x', description: 'y', instruction: 'z' };
    expect(workflowTemplateSchema.safeParse({ ...base, graph: {} }).success).toBe(false);
    expect(workflowTemplateSchema.safeParse({ ...base, instruction: '  ' }).success).toBe(false);
    expect(
      workflowTemplateSchema.safeParse({ ...base, steps: Array.from({ length: 21 }, () => 's') })
        .success,
    ).toBe(false);
    expect(workflowTemplateSchema.safeParse({ ...base, kind: 'graph' }).success).toBe(false);
  });

  it('is never mistaken for a saved graph', () => {
    expect(savedWorkflowSchema.safeParse(template).success).toBe(false);
  });

  it('builds a run prompt with steps, checks and the request', () => {
    expect(workflowTemplateRunPrompt(template, '  v2.0  ')).toBe(
      [
        'Run the workflow "Release notes" from .clawai/workflows.',
        'Summarise every change since the last tag for users.',
        'Follow these steps in order:',
        '1. Read git log since the last tag',
        '2. Group changes by area',
        'Do not report the workflow as done until each check holds, with evidence:',
        '1. Every commit is accounted for',
        'Request: v2.0',
      ].join('\n'),
    );
  });

  it('omits empty sections and an empty request', () => {
    const bare = { ...template, steps: [], acceptanceChecks: [] };
    expect(workflowTemplateRunPrompt(bare, '   ')).toBe(
      [
        'Run the workflow "Release notes" from .clawai/workflows.',
        'Summarise every change since the last tag for users.',
      ].join('\n'),
    );
    expect(workflowTemplateRunPrompt(bare)).not.toContain('Request:');
  });

  it('lists saved graphs and templates together, templates carrying their definition', () => {
    const picks = savedWorkflowPicks(
      [
        {
          name: 'Graph one',
          description: 'A graph',
          savedAt: 'now',
          graph: flagshipImplementationGraph(),
        },
      ],
      [template],
    );
    expect(picks).toEqual([
      { label: '$(type-hierarchy) Graph one', description: 'A graph', name: 'Graph one' },
      {
        label: '$(list-ordered) Release notes',
        description: template.description,
        name: 'Release notes',
        template,
      },
    ]);
  });
});
