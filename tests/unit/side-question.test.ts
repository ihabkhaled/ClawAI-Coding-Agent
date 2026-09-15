import { describe, expect, it } from 'vitest';

import { SIDE_QUESTION_THREAD_TITLE, renderSideAnswer } from '../../src/core/side-question';

describe('renderSideAnswer', () => {
  it('repeats the question above the answer', () => {
    const rendered = renderSideAnswer({ question: 'What is zod?', content: 'A schema library.' });

    expect(rendered).toContain('> What is zod?');
    expect(rendered.indexOf('What is zod?')).toBeLessThan(rendered.indexOf('A schema library.'));
  });

  it('quotes every line of a multi-line question', () => {
    const rendered = renderSideAnswer({ question: 'one\ntwo', content: 'answer' });

    expect(rendered).toContain('> one\n> two');
  });

  it('says the answer is outside the conversation', () => {
    const rendered = renderSideAnswer({ question: 'q', content: 'a' });

    expect(rendered).toContain('outside the conversation');
  });

  it('trims an answer that arrived with padding', () => {
    expect(renderSideAnswer({ question: 'q', content: '  a  ' })).toContain('\na\n');
  });
});

describe('SIDE_QUESTION_THREAD_TITLE', () => {
  it('is a name a user would recognise if they went looking', () => {
    expect(SIDE_QUESTION_THREAD_TITLE).toContain('ClawAI');
  });
});
