import { describe, expect, it } from 'vitest';

import {
  resolveSubAgentDefinition,
  subAgentDefinitionSchema,
  subAgentDefinitionsFileSchema,
} from '../../src/core/sub-agent-definitions';

const reviewer = {
  name: 'strict-reviewer',
  description: 'Reviews for correctness and security with no tolerance for scope creep.',
  systemPrompt: 'You are a strict reviewer. Flag every unverified claim.',
};

describe('subAgentDefinitionSchema', () => {
  it('accepts a well-formed definition', () => {
    expect(subAgentDefinitionSchema.parse(reviewer)).toEqual(reviewer);
  });

  it.each(['Strict-Reviewer', 'strict_reviewer', '1-reviewer', ''])(
    'rejects a name that is not lowercase-kebab starting with a letter: %s',
    (name) => {
      expect(subAgentDefinitionSchema.safeParse({ ...reviewer, name }).success).toBe(false);
    },
  );

  it('rejects an unknown property', () => {
    expect(subAgentDefinitionSchema.safeParse({ ...reviewer, model: 'gpt' }).success).toBe(false);
  });
});

describe('subAgentDefinitionsFileSchema', () => {
  it('accepts an empty array', () => {
    expect(subAgentDefinitionsFileSchema.parse([])).toEqual([]);
  });

  it('accepts distinct definitions', () => {
    const documenter = { ...reviewer, name: 'terse-documenter' };
    expect(subAgentDefinitionsFileSchema.parse([reviewer, documenter])).toHaveLength(2);
  });

  it('rejects duplicate names', () => {
    expect(subAgentDefinitionsFileSchema.safeParse([reviewer, reviewer]).success).toBe(false);
  });
});

describe('resolveSubAgentDefinition', () => {
  it('returns undefined when no name was requested', () => {
    expect(resolveSubAgentDefinition([reviewer], undefined)).toBeUndefined();
  });

  it('returns undefined when the requested name is not registered', () => {
    expect(resolveSubAgentDefinition([reviewer], 'ghost')).toBeUndefined();
  });

  it('returns the exact match by name', () => {
    expect(resolveSubAgentDefinition([reviewer], 'strict-reviewer')).toEqual(reviewer);
  });
});
