import { describe, expect, it } from 'vitest';

import {
  decideToolInvocationRepair,
  normalizeToolInvocation,
} from '../../src/core/runtime/runtime-tool-normalization';

const invocation = {
  schemaVersion: '2.0',
  invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
  toolName: 'workspace.context',
  toolVersion: '1.0',
  operation: 'read',
  arguments: { section: 'architecture' },
  targetId: 'target:primary',
  epochs: { account: 1, workspace: 2, target: 3, policy: 4 },
  idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
  requestedAt: '2026-08-02T08:00:00.000Z',
};

const envelope = { toolInvocation: invocation };

describe('runtime tool normalization', () => {
  it('normalizes an already canonical native invocation without adding source metadata', () => {
    expect(normalizeToolInvocation({ kind: 'native', value: invocation })).toEqual(invocation);
  });

  it('normalizes a strict structured JSON envelope', () => {
    expect(normalizeToolInvocation({ kind: 'structured-json', value: envelope })).toEqual(
      invocation,
    );
    expect(() =>
      normalizeToolInvocation({
        kind: 'structured-json',
        value: { ...envelope, sourceRuntime: 'local' },
      }),
    ).toThrow();
    expect(() => normalizeToolInvocation({ kind: 'structured-json', value: invocation })).toThrow();
  });

  it('parses an exact full-document plain JSON envelope', () => {
    expect(
      normalizeToolInvocation({
        kind: 'plain-json',
        value: `\n  ${JSON.stringify(envelope)}\n`,
      }),
    ).toEqual(invocation);
  });

  it.each([
    `\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``,
    `${JSON.stringify(envelope)} trailing prose`,
    `${JSON.stringify(envelope)}\n${JSON.stringify(envelope)}`,
    JSON.stringify({ ...envelope, explanation: 'Use this tool.' }),
    JSON.stringify({ toolInvocation: { ...invocation, sourceCallId: 'source-1' } }),
  ])('rejects non-exact or provider-shaped plain output', (value) => {
    expect(() => normalizeToolInvocation({ kind: 'plain-json', value })).toThrow();
  });

  it('rejects empty, malformed, and oversized plain output before dispatch', () => {
    expect(() => normalizeToolInvocation({ kind: 'plain-json', value: '   ' })).toThrow(/empty/i);
    expect(() =>
      normalizeToolInvocation({ kind: 'plain-json', value: '{"toolInvocation":' }),
    ).toThrow(/json/i);
    expect(() =>
      normalizeToolInvocation({ kind: 'plain-json', value: 'x'.repeat(600_000) }),
    ).toThrow(/bytes/i);
  });

  it('offers one bounded repair prompt after the first normalization failure', () => {
    const decision = decideToolInvocationRepair(0);

    expect(decision).toMatchObject({ action: 'repair', repairAttempt: 1 });
    if (decision.action === 'repair') {
      expect(decision.prompt.length).toBeLessThan(2_000);
      expect(decision.prompt).toContain('exactly one JSON document');
      expect(decision.prompt).toContain('toolInvocation');
      expect(decision.prompt).toContain('No Markdown');
    }
  });

  it('rejects a second failure instead of offering another repair', () => {
    expect(decideToolInvocationRepair(1)).toEqual({
      action: 'reject',
      reason: 'repair-exhausted',
    });
    expect(() => decideToolInvocationRepair(-1)).toThrow(/attempt/i);
    expect(() => decideToolInvocationRepair(2)).toThrow(/attempt/i);
  });
});
