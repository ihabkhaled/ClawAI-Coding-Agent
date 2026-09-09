import { describe, expect, it, vi } from 'vitest';

import { conversationEndInputSchema, decideConversationEnd } from '../../src/core/conversation-end';
import {
  EndConversationToolExecutor,
  endConversationToolDefinition,
} from '../../src/infrastructure/end-conversation-tool-executor';

import type { ConversationEndInput, PendingInterruptions } from '../../src/core/conversation-end';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const idle: PendingInterruptions = { approvalTitle: undefined, questionHeader: undefined };

function invocation(overrides: Partial<ToolInvocation> = {}): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:end-test',
    runId: 'runtime:end-test',
    turnId: 'turn:end-test',
    toolName: 'runtime.end',
    toolVersion: '2.0.0',
    operation: 'end',
    arguments: { reason: 'Shipped the migration and the tests pass.' },
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:end-test',
    requestedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  };
}

function port(pending: PendingInterruptions = idle) {
  return {
    pending: () => pending,
    finish: vi.fn<(input: ConversationEndInput) => Promise<void>>(async () => undefined),
  };
}

describe('decideConversationEnd', () => {
  it('allows ending when nothing is waiting on the user', () => {
    expect(decideConversationEnd(idle)).toEqual({ allowed: true });
  });

  it('refuses while an approval is open and names it', () => {
    const decision = decideConversationEnd({ ...idle, approvalTitle: 'Run npm test' });

    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? '' : decision.refusal).toContain('Run npm test');
  });

  it('refuses while a question is open and names it', () => {
    const decision = decideConversationEnd({ ...idle, questionHeader: 'Which database?' });

    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? '' : decision.refusal).toContain('Which database?');
  });

  it('has no override for either', () => {
    expect(Object.keys(conversationEndInputSchema.shape).sort()).toEqual(['lifecycle', 'reason']);
  });
});

describe('conversationEndInputSchema', () => {
  it('defaults the lifecycle to completed', () => {
    expect(conversationEndInputSchema.parse({ reason: 'Done.' })).toEqual({
      reason: 'Done.',
      lifecycle: 'completed',
    });
  });

  it('rejects a reason that says nothing', () => {
    expect(conversationEndInputSchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('rejects a lifecycle the journal does not treat as terminal', () => {
    expect(
      conversationEndInputSchema.safeParse({ reason: 'Done.', lifecycle: 'resumable' }).success,
    ).toBe(false);
  });
});

describe('EndConversationToolExecutor', () => {
  it('writes the terminal record and reports the lifecycle', async () => {
    const conversation = port();
    const executor = new EndConversationToolExecutor(conversation);

    const output = await executor.execute(invocation());

    expect(conversation.finish).toHaveBeenCalledWith({
      reason: 'Shipped the migration and the tests pass.',
      lifecycle: 'completed',
    });
    expect(output).toEqual({ structured: { ended: true, lifecycle: 'completed' } });
  });

  it('refuses as a result rather than an error, and records nothing', async () => {
    const conversation = port({ ...idle, approvalTitle: 'Run npm test' });
    const executor = new EndConversationToolExecutor(conversation);

    const output = await executor.execute(invocation());

    expect(conversation.finish).not.toHaveBeenCalled();
    expect(output.structured).toMatchObject({ ended: false });
    expect(String(output.structured?.refusal)).toContain('Run npm test');
  });

  it('carries an explicit abandoned lifecycle through', async () => {
    const conversation = port();
    const executor = new EndConversationToolExecutor(conversation);

    await executor.execute(
      invocation({
        arguments: { reason: 'Blocked on a missing credential.', lifecycle: 'abandoned' },
      }),
    );

    expect(conversation.finish).toHaveBeenCalledWith({
      reason: 'Blocked on a missing credential.',
      lifecycle: 'abandoned',
    });
  });

  it('is advertised with no write risk and one operation', () => {
    expect(endConversationToolDefinition.riskClasses).toEqual(['inspect']);
    expect(endConversationToolDefinition.operations).toEqual(['end']);
    expect(endConversationToolDefinition.description.length).toBeLessThanOrEqual(2_000);
  });
});
