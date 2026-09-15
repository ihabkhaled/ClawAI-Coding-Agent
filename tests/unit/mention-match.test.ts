import { describe, expect, it } from 'vitest';

import {
  applyMention,
  parseMentionQuery,
  rankMentionCandidates,
} from '../../src/core/mention-match';

const paths = [
  'src/services/workspace-context-service.ts',
  'src/core/context-collector.ts',
  'src/webview/chat-composer-markup.ts',
  'README.md',
  'src/core/',
];

describe('parseMentionQuery', () => {
  it('finds a mention the caret is inside', () => {
    expect(parseMentionQuery('look at @work', 13)).toEqual({ start: 8, end: 13, query: 'work' });
  });

  it('finds a mention at the very start', () => {
    expect(parseMentionQuery('@src', 4)?.query).toBe('src');
  });

  it('narrows to the caret rather than the end of the word', () => {
    expect(parseMentionQuery('@workspace', 5)?.query).toBe('work');
  });

  it('is not fooled by an email address', () => {
    expect(parseMentionQuery('mail ihab@example.com', 21)).toBeUndefined();
  });

  it('ends the mention at whitespace', () => {
    expect(parseMentionQuery('@src/core and then', 18)).toBeUndefined();
  });

  it('has no mention when there is no @ before the caret', () => {
    expect(parseMentionQuery('plain text', 10)).toBeUndefined();
  });

  it('opens a mention the moment @ is typed', () => {
    expect(parseMentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });
});

describe('rankMentionCandidates', () => {
  it('matches a subsequence, not just a substring', () => {
    expect(rankMentionCandidates(paths, 'wcs')[0]?.path).toBe(
      'src/services/workspace-context-service.ts',
    );
  });

  it('prefers a match in the file name over one in a directory', () => {
    expect(rankMentionCandidates(paths, 'collector')[0]?.path).toBe(
      'src/core/context-collector.ts',
    );
  });

  it('offers something the moment @ is typed rather than an empty list', () => {
    expect(rankMentionCandidates(paths, '').length).toBeGreaterThan(0);
  });

  it('drops paths the query cannot match at all', () => {
    expect(rankMentionCandidates(paths, 'zzzz')).toEqual([]);
  });

  it('reports where the query matched so the list can show it', () => {
    const match = rankMentionCandidates(['README.md'], 'rme')[0];

    expect(match?.positions).toEqual([0, 4, 5]);
  });

  it('never offers more than the limit', () => {
    expect(rankMentionCandidates(paths, '', 2)).toHaveLength(2);
  });

  it('breaks ties by path so the list does not reshuffle between keystrokes', () => {
    const first = rankMentionCandidates(['b/x.ts', 'a/x.ts'], 'x');
    const again = rankMentionCandidates(['a/x.ts', 'b/x.ts'], 'x');

    expect(first.map(({ path }) => path)).toEqual(again.map(({ path }) => path));
  });
});

function replace(text: string, caret: number, path: string): string {
  const mention = parseMentionQuery(text, caret);
  if (mention === undefined) throw new Error(`No mention in ${text} at ${String(caret)}`);
  return applyMention(text, mention, path).text;
}

describe('applyMention', () => {
  it('replaces the typed mention with the chosen path and a space', () => {
    const mention = parseMentionQuery('look at @work', 13);

    expect(mention && applyMention('look at @work', mention, 'src/app.ts')).toEqual({
      text: 'look at @src/app.ts ',
      caretIndex: 20,
    });
  });

  it('keeps a folder mention open so the next keystroke narrows inside it', () => {
    expect(replace('@sr', 3, 'src/')).toBe('@src/');
  });

  it('keeps whatever followed the caret', () => {
    expect(replace('@work and more', 5, 'w.ts')).toBe('@w.ts and more');
  });

  it('does not double the space when the mention already ends in one', () => {
    expect(replace('@w file', 2, 'w.ts')).toBe('@w.ts file');
  });
});
