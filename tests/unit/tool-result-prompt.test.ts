import { describe, expect, it } from 'vitest';

import { buildToolResultPrompt, isDiagnosticToolPlan } from '../../src/services/tool-result-prompt';

describe('tool result prompts', () => {
  it('recognizes only command-only Docker diagnostic plans', () => {
    expect(
      isDiagnosticToolPlan({
        summary: 'Inspect',
        files: [],
        commands: [{ command: 'docker ps', purpose: 'List containers' }],
      }),
    ).toBe(true);
    expect(isDiagnosticToolPlan({ summary: 'Answer', files: [] })).toBe(false);
    expect(
      isDiagnosticToolPlan({
        summary: 'Verify',
        files: [],
        commands: [{ command: 'npm test', purpose: 'Test' }],
      }),
    ).toBe(false);
  });

  it('serializes bounded command receipts as untrusted tool results', () => {
    const prompt = buildToolResultPrompt(
      'inspect Docker',
      [
        { command: 'docker ps', purpose: 'List containers' },
        { command: 'docker logs service', purpose: 'Read logs' },
      ],
      [{ exitCode: 0, stdout: 'healthy', stderr: '', truncated: false }],
    );
    expect(prompt).toContain('<tool-results>');
    expect(prompt).toContain('"stdout":"healthy"');
    expect(prompt).toContain('"exitCode":null');
    expect(prompt).toContain('untrusted data');
  });
});
