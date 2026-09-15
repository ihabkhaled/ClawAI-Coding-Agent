import type { SideQuestionAnswer } from './side-question.types';

/**
 * What a side-question thread is called.
 *
 * Named, not anonymous, because it does exist on the server and a user who
 * goes looking should find something they recognise rather than an untitled
 * conversation they cannot account for.
 */
export const SIDE_QUESTION_THREAD_TITLE = 'ClawAI side questions';

/**
 * The answer, written for reading rather than for a transcript.
 *
 * The question is repeated above the answer. A side question is read later,
 * often after several others, and an answer with no question above it is a
 * paragraph nobody can place.
 */
export function renderSideAnswer(answer: SideQuestionAnswer): string {
  return [
    '# Side question',
    '',
    `> ${answer.question.replaceAll('\n', '\n> ')}`,
    '',
    answer.content.trim(),
    '',
    '---',
    '',
    'Asked outside the conversation, so nothing above is part of what the agent',
    'is carrying forward.',
  ].join('\n');
}
