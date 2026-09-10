import { describe, expect, it, vi } from 'vitest';

import {
  advisorInputSchema,
  buildAdvicePrompt,
  pickAdvisor,
  recordAdvice,
} from '../../src/core/advisor';
import {
  AdvisorToolExecutor,
  advisorToolDefinition,
} from '../../src/infrastructure/advisor-tool-executor';

import type { ModelCatalogEntry } from '../../src/core/model-catalog';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function entry(overrides: Partial<ModelCatalogEntry>): ModelCatalogEntry {
  return {
    id: 'id',
    key: 'P:m',
    provider: 'P',
    model: 'm',
    displayName: 'Model',
    isLocal: false,
    source: 'connector',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: false,
    contextTokens: 100_000,
    ...overrides,
  };
}

function invocation(args: Record<string, unknown>): ToolInvocation {
  return {
    toolName: advisorToolDefinition.name,
    operation: 'consult',
    arguments: args,
  } as ToolInvocation;
}

describe('pickAdvisor', () => {
  it('never picks the model that is already running', () => {
    const catalog = [entry({ key: 'A:1' }), entry({ key: 'B:2', displayName: 'Other' })];

    expect(pickAdvisor(catalog, 'A:1')?.key).toBe('B:2');
  });

  it('has no advisor when the account can reach only one model', () => {
    expect(pickAdvisor([entry({ key: 'A:1' })], 'A:1')).toBeUndefined();
    expect(pickAdvisor([], '')).toBeUndefined();
  });

  it('prefers a tool-capable model over one that cannot call tools', () => {
    const catalog = [
      entry({ key: 'A:1', supportsTools: false, contextTokens: 900_000 }),
      entry({ key: 'B:2', supportsTools: true, contextTokens: 1_000 }),
    ];

    expect(pickAdvisor(catalog, 'running')?.key).toBe('B:2');
  });

  it('prefers a remote model over a local one, which is usually the small one', () => {
    const catalog = [entry({ key: 'A:1', isLocal: true }), entry({ key: 'B:2', isLocal: false })];

    expect(pickAdvisor(catalog, 'running')?.key).toBe('B:2');
  });

  it('breaks the remaining tie on context window', () => {
    const catalog = [
      entry({ key: 'A:1', contextTokens: 8_000 }),
      entry({ key: 'B:2', contextTokens: 200_000 }),
    ];

    expect(pickAdvisor(catalog, 'running')?.key).toBe('B:2');
  });
});

describe('buildAdvicePrompt', () => {
  it('tells the advisor it is advising and must not act', () => {
    const prompt = buildAdvicePrompt('Is this safe?', '');

    expect(prompt).toContain('advising, not deciding');
    expect(prompt).toContain('Do not propose or perform any action');
    expect(prompt).toContain('Is this safe?');
  });

  it('leaves the context section out entirely when there is none', () => {
    expect(buildAdvicePrompt('Q', '   ')).not.toContain('Context:');
  });
});

describe('recordAdvice', () => {
  it('names the advisor and marks the advice non-binding', () => {
    const record = recordAdvice(
      { key: 'B:2', provider: 'B', model: '2', displayName: 'Second Opinion' },
      'Q',
      'A',
    );

    expect(record).toEqual({
      advisor: 'Second Opinion',
      question: 'Q',
      advice: 'A',
      binding: false,
    });
  });
});

describe('advisorInputSchema', () => {
  it('needs a question and defaults the context to nothing', () => {
    expect(advisorInputSchema.parse({ question: 'Q' })).toEqual({ question: 'Q', context: '' });
    expect(() => advisorInputSchema.parse({ question: '   ' })).toThrow();
  });
});

describe('AdvisorToolExecutor', () => {
  it('consults a different model and returns its advice as advice', async () => {
    const consult = vi.fn(async () => 'I would not.');
    const executor = new AdvisorToolExecutor({
      catalog: () => [entry({ key: 'A:1' }), entry({ key: 'B:2', displayName: 'Other' })],
      runningModelKey: () => 'A:1',
      consult,
    });

    const output = await executor.execute(invocation({ question: 'Should I force push?' }));

    expect(output.structured).toEqual({
      consulted: true,
      advisor: 'Other',
      question: 'Should I force push?',
      advice: 'I would not.',
      binding: false,
    });
    expect(consult).toHaveBeenCalledTimes(1);
  });

  it('reports rather than fails when the account can reach only one model', async () => {
    const consult = vi.fn(async () => 'never called');
    const executor = new AdvisorToolExecutor({
      catalog: () => [entry({ key: 'A:1' })],
      runningModelKey: () => 'A:1',
      consult,
    });

    const output = await executor.execute(invocation({ question: 'Q' }));

    expect(output.structured).toEqual({
      consulted: false,
      reason: 'no-second-model',
      binding: false,
    });
    expect(consult).not.toHaveBeenCalled();
  });

  it('refuses a consultation with no question', async () => {
    const executor = new AdvisorToolExecutor({
      catalog: () => [entry({ key: 'B:2' })],
      runningModelKey: () => 'A:1',
      consult: vi.fn(async () => 'x'),
    });

    await expect(executor.execute(invocation({ question: '' }))).rejects.toThrow();
  });

  it('is an inspect-class tool, because advice changes nothing on its own', () => {
    expect(advisorToolDefinition.riskClasses).toEqual(['inspect']);
  });
});
