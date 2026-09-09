import { describe, expect, it } from 'vitest';

import {
  buildSubAgentPrompt,
  describeSubAgentFailure,
} from '../../src/services/runtime-sub-agent-executor';

import type { SubAgentTask } from '../../src/core/multi-agent-dag';
import type { SubAgentDefinition } from '../../src/core/sub-agent-definitions';

const task: SubAgentTask = {
  taskId: 'batch-01',
  role: 'reviewer',
  goal: 'Review the diff for correctness.',
  modelPolicy: {
    allowedProviders: ['OLLAMA'],
    allowedModels: ['kimi-k2.7-code'],
    localPreferred: true,
    minimumContextTokens: 0,
  },
  contextNodeIds: [],
  dependencies: [],
  writeSet: [],
  integrationSeams: [],
  worktreeId: 'wt-batch-01',
  budget: { maxTokens: 200_000, maxToolCalls: 200, maxRuntimeMs: 2_700_000, maxRetries: 1 },
  tools: ['workspace.quality'],
  riskCeiling: 'R1',
  acceptanceChecks: ['npm test'],
  epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
};

const preset: SubAgentDefinition = {
  name: 'strict-reviewer',
  description: 'Reviews for correctness and security.',
  systemPrompt: 'Flag every unverified claim and reject scope creep.',
};

describe('describeSubAgentFailure', () => {
  it("surfaces the nested runtime's actual code and message", () => {
    const description = describeSubAgentFailure({
      reason: { code: 'PROVIDER_UNAVAILABLE', message: 'The Ollama provider timed out.' },
    });

    expect(description).toBe(
      'Nested runtime failed: The Ollama provider timed out. (PROVIDER_UNAVAILABLE)',
    );
  });

  it('falls back to the generic message when the event carries no reason', () => {
    expect(describeSubAgentFailure({})).toBe('Nested runtime failed');
  });

  it('falls back to the generic message when reason is not an object', () => {
    expect(describeSubAgentFailure({ reason: 'not an object' })).toBe('Nested runtime failed');
  });

  it('falls back to the generic message when reason has neither field populated', () => {
    expect(describeSubAgentFailure({ reason: { code: '', message: '' } })).toBe(
      'Nested runtime failed',
    );
  });

  it('reports the code alone when the message is empty', () => {
    expect(describeSubAgentFailure({ reason: { code: 'TIMEOUT', message: '' } })).toBe(
      'Nested runtime failed: TIMEOUT',
    );
  });

  it('reports the message alone when the code is empty', () => {
    expect(
      describeSubAgentFailure({
        reason: { code: '', message: 'Model provider rejected the request.' },
      }),
    ).toBe('Nested runtime failed: Model provider rejected the request.');
  });
});

describe('buildSubAgentPrompt', () => {
  it('omits the definition section when no preset is resolved', () => {
    const prompt = buildSubAgentPrompt(task, [], undefined);

    expect(prompt).not.toContain('Definition:');
    expect(prompt).toContain('Role: reviewer');
    expect(prompt).toContain('Goal: Review the diff for correctness.');
  });

  it('prepends the preset name, description, and system prompt when resolved', () => {
    const prompt = buildSubAgentPrompt(task, [], preset);

    expect(prompt).toContain('Definition: strict-reviewer — Reviews for correctness and security.');
    expect(prompt).toContain('Flag every unverified claim and reject scope creep.');
    expect(prompt.indexOf('Definition:')).toBeLessThan(prompt.indexOf('Goal:'));
  });

  it('still carries the safety line regardless of a preset', () => {
    const prompt = buildSubAgentPrompt(task, [], preset);

    expect(prompt).toContain(
      'Do not broaden scope, elevate, push, publish, or access another root.',
    );
  });

  it('includes steering only when present, preset or not', () => {
    const withoutSteering = buildSubAgentPrompt(task, [], preset);
    const withSteering = buildSubAgentPrompt(task, ['Focus on the auth module.'], preset);

    expect(withoutSteering).not.toContain('Current steering');
    expect(withSteering).toContain('Current steering:\nFocus on the auth module.');
  });
});
