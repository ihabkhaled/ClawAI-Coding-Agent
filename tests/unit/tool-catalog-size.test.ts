import { describe, expect, it } from 'vitest';

import { catalogBudgetProblems } from '../../src/sdk/tool-catalog-budget';
import {
  CATALOG_CHAR_BASELINE,
  NEWER_TOOLS,
  TOOL_CHAR_BASELINE,
} from '../../src/sdk/tool-catalog-budget.constants';
import { catalogScenarios } from '../../src/sdk/tool-catalog-scenarios';
import {
  estimateTokens,
  formatCatalog,
  measureCatalog,
  measureDefinition,
} from '../../src/sdk/tool-catalog-size';

const sizes = catalogScenarios().map(measureCatalog);
const everything = sizes.find((size) => size.label === 'every category');

describe('tool catalog size', () => {
  it('measures a definition the way it is sent', () => {
    const definition = {
      name: 'demo.tool',
      description: 'abcd',
      operations: ['a', 'b'],
      inputSchema: { type: 'object' },
    };
    const size = measureDefinition(definition);

    expect(size.chars).toBe(JSON.stringify(definition).length);
    expect(size.operations).toBe(2);
    expect(size.descriptionChars).toBe('"abcd"'.length);
    expect(size.schemaChars).toBe('{"type":"object"}'.length);
    expect(size.tokens).toBe(estimateTokens(size.chars));
    expect(estimateTokens(7)).toBe(2);
  });

  it('prints one row per tool and a total', () => {
    const text = formatCatalog(measureCatalog({ label: 'demo', definitions: [{ name: 'a.b' }] }));

    expect(text).toContain('== demo ==');
    expect(text).toContain('a.b');
    expect(text).toContain('TOTAL demo');
  });

  it('keeps every tool and every catalog inside its budget', () => {
    expect(sizes.flatMap(catalogBudgetProblems)).toEqual([]);
  });

  it('fails a tool that outgrows its budget or has none', () => {
    const grown = measureCatalog({
      label: 'x',
      definitions: [
        { name: 'workspace.notes', description: 'x'.repeat(5_000) },
        { name: 'new.tool' },
      ],
    });
    const problems = catalogBudgetProblems(grown);

    expect(problems.some((problem) => problem.startsWith('workspace.notes is'))).toBe(true);
    expect(problems).toContain('new.tool has no budget in TOOL_CHAR_BUDGETS');
  });

  it('saved at least 25% on the newer tools and 10% on the older ones', () => {
    const chars = (name: string): number =>
      everything?.tools.find((tool) => tool.name === name)?.chars ?? Number.POSITIVE_INFINITY;
    const total = (names: readonly string[], source: (name: string) => number): number =>
      names.reduce((sum, name) => sum + source(name), 0);
    const newer = [...NEWER_TOOLS];
    const older = Object.keys(TOOL_CHAR_BASELINE).filter((name) => !newer.includes(name));

    const before = (name: string): number => TOOL_CHAR_BASELINE[name] ?? 0;
    expect(total(newer, chars)).toBeLessThanOrEqual(total(newer, before) * 0.75);
    expect(total(older, chars)).toBeLessThanOrEqual(total(older, before) * 0.9);
  });

  it('keeps each catalog under its 1.97.0 baseline', () => {
    for (const [label, baseline] of Object.entries(CATALOG_CHAR_BASELINE)) {
      const size = sizes.find((entry) => entry.label === label);
      expect(size?.chars ?? Number.POSITIVE_INFINITY).toBeLessThan(baseline * 0.8);
    }
  });

  it('sends the stubs catalog well under the whole one', () => {
    const stubs = sizes.find((size) => size.label === 'every category, deferred stubs');

    expect(stubs?.chars ?? Number.POSITIVE_INFINITY).toBeLessThan((everything?.chars ?? 0) * 0.7);
  });
});
