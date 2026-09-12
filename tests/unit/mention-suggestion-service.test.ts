import { describe, expect, it } from 'vitest';

import { MentionSuggestionService } from '../../src/services/mention-suggestion-service';

function service(paths: string[], skills: string[] = []): MentionSuggestionService {
  return new MentionSuggestionService(
    { paths: async () => paths },
    { list: async () => skills.map((name) => ({ name })) },
  );
}

describe('MentionSuggestionService', () => {
  it('offers ranked paths and the span the choice replaces', async () => {
    const suggestions = await service(['src/app.ts', 'README.md']).suggest('see @app', 8);

    expect(suggestions).toEqual({ start: 4, end: 8, paths: ['src/app.ts'] });
  });

  it('offers nothing, and no span, when the caret is not in a mention', async () => {
    expect(await service(['src/app.ts']).suggest('plain text', 10)).toEqual({
      start: -1,
      end: -1,
      paths: [],
    });
  });

  it('does not read the index when there is no mention to answer', async () => {
    let reads = 0;
    const subject = new MentionSuggestionService(
      {
        paths: async () => {
          reads += 1;
          return [];
        },
      },
      { list: async () => [] },
    );

    await subject.suggest('plain text', 10);

    expect(reads).toBe(0);
  });
});

describe('MentionSuggestionService slash commands', () => {
  it('offers every command the moment a slash is typed', async () => {
    const suggestions = await service([], ['audit', 'review']).suggest('/', 1);

    expect(suggestions.paths).toEqual(['/audit', '/review']);
  });

  it('narrows by prefix as the name is typed', async () => {
    const suggestions = await service([], ['audit', 'review']).suggest('/rev', 4);

    expect(suggestions.paths).toEqual(['/review']);
  });

  it('matches by prefix, not subsequence, so a typo cannot reach a distant command', async () => {
    const suggestions = await service([], ['deploy']).suggest('/dp', 3);

    expect(suggestions.paths).toEqual([]);
  });

  it('replaces the whole command being typed', async () => {
    const suggestions = await service([], ['review']).suggest('/rev', 4);

    expect(suggestions).toMatchObject({ start: 0, end: 4 });
  });

  it('stops offering commands once an argument is being typed', async () => {
    const suggestions = await service([], ['review']).suggest('/review src', 11);

    expect(suggestions).toEqual({ start: -1, end: -1, paths: [] });
  });

  it('leaves an @ mention to the mention path', async () => {
    const suggestions = await service(['src/app.ts'], ['review']).suggest('see @app', 8);

    expect(suggestions.paths).toEqual(['src/app.ts']);
  });
});
