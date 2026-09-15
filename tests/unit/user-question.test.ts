import { describe, expect, it } from 'vitest';

import {
  describeQuestionAnswer,
  resolveQuestionAnswer,
  userQuestionInputSchema,
} from '../../src/core/user-question';

import type { UserQuestion } from '../../src/core/user-question';

const question: UserQuestion = {
  id: 'q1',
  header: 'Storage',
  question: 'Which store should the cache use?',
  options: [{ label: 'Redis' }, { label: 'In-memory', description: 'No persistence' }],
  allowOther: true,
};

describe('userQuestionInputSchema', () => {
  it('accepts a well-formed question and defaults to allowing free text', () => {
    const parsed = userQuestionInputSchema.parse({
      header: 'Storage',
      question: 'Which store?',
      options: [{ label: 'Redis' }, { label: 'In-memory' }],
    });

    expect(parsed.allowOther).toBe(true);
  });

  // One option is a statement, not a question, and more than four stops being
  // readable in a narrow sidebar or navigable from the keyboard.
  it('requires between two and four options', () => {
    const base = { header: 'Storage', question: 'Which store?' };

    expect(
      userQuestionInputSchema.safeParse({ ...base, options: [{ label: 'Redis' }] }).success,
    ).toBe(false);
    expect(
      userQuestionInputSchema.safeParse({
        ...base,
        options: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }],
      }).success,
    ).toBe(false);
  });

  it('refuses options the user could not tell apart', () => {
    expect(
      userQuestionInputSchema.safeParse({
        header: 'Storage',
        question: 'Which store?',
        options: [{ label: 'Redis' }, { label: 'redis' }],
      }).success,
    ).toBe(false);
  });
});

describe('resolveQuestionAnswer', () => {
  it('accepts a label the question actually offered', () => {
    expect(resolveQuestionAnswer(question, { label: 'Redis' })).toEqual({
      kind: 'option',
      label: 'Redis',
    });
  });

  // The webview is untrusted input. A selection naming an option from a
  // previous question would otherwise resolve the run with an answer the user
  // never gave.
  it('refuses a label the question did not offer', () => {
    expect(resolveQuestionAnswer(question, { label: 'Postgres' })).toBeUndefined();
    expect(resolveQuestionAnswer(question, { label: 'redis' })).toBeUndefined();
  });

  it('accepts free text only when the question allows it', () => {
    expect(resolveQuestionAnswer(question, { other: '  DynamoDB  ' })).toEqual({
      kind: 'other',
      text: 'DynamoDB',
    });
    expect(
      resolveQuestionAnswer({ ...question, allowOther: false }, { other: 'DynamoDB' }),
    ).toBeUndefined();
  });

  it('refuses empty, malformed and absent selections', () => {
    expect(resolveQuestionAnswer(question, { other: '   ' })).toBeUndefined();
    expect(resolveQuestionAnswer(question, {})).toBeUndefined();
    expect(resolveQuestionAnswer(question, null)).toBeUndefined();
    expect(resolveQuestionAnswer(question, { label: 42 })).toBeUndefined();
  });
});

describe('describeQuestionAnswer', () => {
  it('reports the chosen label or the typed text', () => {
    expect(describeQuestionAnswer({ kind: 'option', label: 'Redis' })).toBe('Redis');
    expect(describeQuestionAnswer({ kind: 'other', text: 'DynamoDB' })).toBe('DynamoDB');
  });

  // The agent asked because it could not decide. Substituting a default would
  // put words in the user's mouth and hide that the question went unanswered.
  it('reports a dismissal as a dismissal rather than a default choice', () => {
    expect(describeQuestionAnswer({ kind: 'dismissed' })).toMatch(/dismissed/i);
  });
});
