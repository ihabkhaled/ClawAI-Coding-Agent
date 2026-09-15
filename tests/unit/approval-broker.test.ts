import { describe, expect, it } from 'vitest';

import { ApprovalBroker } from '../../src/core/approval-broker';

describe('ApprovalBroker', () => {
  it('publishes one internal approval at a time and resolves in order', async () => {
    const requests: unknown[] = [];
    const broker = new ApprovalBroker({
      update: (patch) => {
        requests.push(patch.approvalRequest);
      },
    });

    const first = broker.request({
      kind: 'workspaceContext',
      message: 'Read the workspace',
      title: 'Workspace access',
    });
    const firstRequest = broker.current;
    const second = broker.request({
      details: ['src/app.ts'],
      kind: 'finalDiff',
      message: 'Apply one file',
      title: 'Apply changes',
    });

    expect(firstRequest).toMatchObject({ kind: 'workspaceContext' });
    expect(broker.current?.id).toBe(firstRequest?.id);
    expect(broker.resolve(firstRequest?.id ?? '', true)).toBe(true);
    await expect(first).resolves.toBe(true);

    const secondRequest = broker.current;
    expect(secondRequest).toMatchObject({
      details: ['src/app.ts'],
      kind: 'finalDiff',
    });
    expect(broker.resolve(secondRequest?.id ?? '', false)).toBe(true);
    await expect(second).resolves.toBe(false);
    expect(broker.current).toBeUndefined();
    expect(requests.at(-1)).toBeUndefined();
  });

  it('rejects stale responses and cancels the current approval without OS prompts', async () => {
    const broker = new ApprovalBroker({
      update: () => undefined,
    });
    const result = broker.request({
      kind: 'editGeneration',
      message: 'Generate edits',
      title: 'Edit access',
    });

    expect(broker.resolve('stale-request', true)).toBe(false);
    expect(broker.cancelCurrent()).toBe(true);
    await expect(result).resolves.toBe(false);
  });

  it('cancels the active and queued approvals at an account boundary', async () => {
    const broker = new ApprovalBroker({ update: () => undefined });
    const first = broker.request({
      kind: 'finalDiff',
      message: 'Apply changes',
      title: 'Apply',
    });
    const second = broker.request({
      kind: 'commandExecution',
      message: 'Run command',
      title: 'Run',
    });

    expect(broker.cancelAll()).toBe(true);

    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    expect(broker.current).toBeUndefined();
  });

  it('removes an aborted run approval and activates the next request', async () => {
    const broker = new ApprovalBroker({ update: () => undefined });
    const controller = new AbortController();
    const first = broker.request(
      {
        kind: 'workspaceContext',
        message: 'Read files for request A',
        title: 'Workspace access',
      },
      controller.signal,
    );
    const second = broker.request({
      kind: 'workspaceContext',
      message: 'Read files for request B',
      title: 'Workspace access',
    });

    controller.abort();

    await expect(first).resolves.toBe(false);
    expect(broker.current?.message).toBe('Read files for request B');
    broker.cancelAll();
    await expect(second).resolves.toBe(false);
  });
  it('withdraws one lane of questions and leaves another lane standing', async () => {
    // A runtime run that ends cannot hear the answer to what it was asking, and
    // an unanswerable modal swallows every click meant for the composer — the
    // user cannot type again until the window is reloaded. Withdrawing by kind
    // clears the dead run's prompts without denying a question another lane is
    // still legitimately waiting on.
    const broker = new ApprovalBroker({ update: () => undefined });

    const runtimeEffect = broker.request({
      kind: 'runtimeEffect',
      message: 'Write one file',
      title: 'Approve agent effect',
    });
    const queuedEffect = broker.request({
      kind: 'runtimeEffect',
      message: 'Write another file',
      title: 'Approve agent effect',
    });
    const otherLane = broker.request({
      kind: 'finalDiff',
      message: 'Apply one file',
      title: 'Apply changes',
    });

    expect(broker.cancelKind('runtimeEffect')).toBe(true);

    await expect(runtimeEffect).resolves.toBe(false);
    await expect(queuedEffect).resolves.toBe(false);
    expect(broker.current).toMatchObject({ kind: 'finalDiff' });
    expect(broker.resolve(broker.current?.id ?? '', true)).toBe(true);
    await expect(otherLane).resolves.toBe(true);
  });

  it('reports nothing to withdraw when that lane has no questions open', () => {
    const broker = new ApprovalBroker({ update: () => undefined });

    expect(broker.cancelKind('runtimeEffect')).toBe(false);
  });
});

describe('ApprovalBroker questions', () => {
  const question = {
    header: 'Storage',
    question: 'Which store should the cache use?',
    options: [{ label: 'Redis' }, { label: 'In-memory' }],
    allowOther: true,
  };

  function broker(published: unknown[] = []) {
    return new ApprovalBroker({
      update: (patch) => {
        published.push(patch.questionRequest);
      },
    });
  }

  it('publishes the question and resolves with the chosen option', async () => {
    const published: unknown[] = [];
    const subject = broker(published);

    const answer = subject.ask(question);
    const asked = published.at(-1) as { id: string };

    expect(asked.id).toBeTypeOf('string');
    expect(subject.answer(asked.id, { label: 'Redis' })).toBe(true);
    await expect(answer).resolves.toEqual({ kind: 'option', label: 'Redis' });
  });

  it('resolves free text when the question allows it', async () => {
    const published: unknown[] = [];
    const subject = broker(published);

    const answer = subject.ask(question);
    const asked = published.at(-1) as { id: string };
    subject.answer(asked.id, { other: 'DynamoDB' });

    await expect(answer).resolves.toEqual({ kind: 'other', text: 'DynamoDB' });
  });

  // A selection naming an option this question never offered would otherwise
  // complete the run with an answer the user did not give.
  it('leaves the question standing when the selection is not one it offered', async () => {
    const published: unknown[] = [];
    const subject = broker(published);

    void subject.ask(question);
    const asked = published.at(-1) as { id: string };

    expect(subject.answer(asked.id, { label: 'Postgres' })).toBe(false);
    expect(subject.answer('some-other-id', { label: 'Redis' })).toBe(false);
    expect(subject.current?.id).toBe(asked.id);
  });

  // A run that ends withdraws what it was asking. The question must report that
  // it went unanswered rather than resolve to one of the options.
  it('reports a withdrawn question as dismissed, never as a choice', async () => {
    const subject = broker();

    const answer = subject.ask(question);
    subject.cancelKind('runtimeQuestion');

    await expect(answer).resolves.toEqual({ kind: 'dismissed' });
  });

  it('shares one modal slot with approvals rather than opening a second one', async () => {
    const subject = broker();

    const approval = subject.request({
      kind: 'workspaceContext',
      message: 'Read the workspace',
      title: 'Workspace access',
    });
    const queued = subject.ask(question);

    // The approval is on screen; the question is queued behind it.
    expect(subject.current?.kind).toBe('workspaceContext');
    subject.resolve(subject.current?.id ?? '', true);
    await expect(approval).resolves.toBe(true);
    expect(subject.current?.kind).toBe('runtimeQuestion');

    subject.cancelAll();
    await expect(queued).resolves.toEqual({ kind: 'dismissed' });
  });
});
