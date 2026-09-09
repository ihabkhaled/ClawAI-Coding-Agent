import { parseMentionQuery, rankMentionCandidates } from '../core/mention-match';

import type { MentionIndexPort, MentionSuggestions } from './mention-suggestion.types';

/** Answered when the caret is not inside a mention: nothing to offer, nothing to replace. */
const NO_MENTION: MentionSuggestions = { start: -1, end: -1, paths: [] };

/**
 * Turns what the user has typed into the list of workspace paths worth
 * offering, and the span the chosen one replaces.
 *
 * The span travels with the suggestions so the composer never has to re-derive
 * where the mention started. Re-deriving it in the webview would be a second
 * implementation of the parser, and the two would disagree the first time
 * either changed.
 */
export class MentionSuggestionService {
  constructor(private readonly index: MentionIndexPort) {}

  async suggest(text: string, caretIndex: number): Promise<MentionSuggestions> {
    const mention = parseMentionQuery(text, caretIndex);
    if (mention === undefined) return NO_MENTION;
    const paths = await this.index.paths();
    return {
      start: mention.start,
      end: mention.end,
      paths: rankMentionCandidates(paths, mention.query).map(({ path }) => path),
    };
  }
}
