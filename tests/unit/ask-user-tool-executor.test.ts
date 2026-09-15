import { describe, expect, it, vi } from 'vitest';

import {
  AskUserToolExecutor,
  askUserToolDefinition,
} from '../../src/infrastructure/ask-user-tool-executor';

import type { RuntimeJsonObject } from '../../src/core/runtime/runtime-tool-contracts';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { UserQuestionAnswer } from '../../src/core/user-question';

function invocation(arguments_: RuntimeJsonObject, operation = 'ask'): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: 'runtime.ask',
    toolVersion: '2.0.0',
    operation,
    arguments: arguments_,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-09-08T16:07:37.239Z',
  };
}

const question = {
  header: 'Storage',
  question: 'Which store should the cache use?',
  options: [{ label: 'Redis' }, { label: 'In-memory' }],
};

function executorFor(answer: UserQuestionAnswer) {
  const ask = vi.fn(async () => answer);
  return { ask, executor: new AskUserToolExecutor({ ask }) };
}

describe('runtime.ask', () => {
  it('advertises one operation and reads as a non-mutating capability', () => {
    expect(askUserToolDefinition.operations).toEqual(['ask']);
    expect(askUserToolDefinition.riskClasses).toEqual(['inspect']);
  });

  it('returns the chosen option to the model', async () => {
    const { executor, ask } = executorFor({ kind: 'option', label: 'Redis' });

    const output = await executor.execute(invocation(question));

    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ header: 'Storage' }), undefined);
    expect(output.structured).toEqual({ answered: true, kind: 'option', answer: 'Redis' });
  });

  it('returns typed free text', async () => {
    const { executor } = executorFor({ kind: 'other', text: 'DynamoDB' });

    const output = await executor.execute(invocation(question));

    expect(output.structured).toMatchObject({ answered: true, answer: 'DynamoDB' });
  });

  // The agent asked because it could not decide. Reporting a dismissal as an
  // answer would let it proceed as though the user had chosen.
  it('reports a dismissal as unanswered rather than as a choice', async () => {
    const { executor } = executorFor({ kind: 'dismissed' });

    const output = await executor.execute(invocation(question));

    expect(output.structured).toMatchObject({ answered: false, kind: 'dismissed' });
    expect(String(output.structured?.answer)).toMatch(/dismissed/i);
  });

  it('refuses a question the user could not answer', async () => {
    const { executor } = executorFor({ kind: 'dismissed' });

    await expect(
      executor.execute(invocation({ ...question, options: [{ label: 'Only one' }] })),
    ).rejects.toThrow();
    await expect(executor.execute(invocation(question, 'tell'))).rejects.toThrow(
      /Unknown ask operation/,
    );
  });
});
