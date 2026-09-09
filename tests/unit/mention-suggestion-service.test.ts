import { describe, expect, it } from 'vitest';

import { MentionSuggestionService } from '../../src/services/mention-suggestion-service';

function service(paths: string[]): MentionSuggestionService {
  return new MentionSuggestionService({ paths: async () => paths });
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
    const subject = new MentionSuggestionService({
      paths: async () => {
        reads += 1;
        return [];
      },
    });

    await subject.suggest('plain text', 10);

    expect(reads).toBe(0);
  });
});
