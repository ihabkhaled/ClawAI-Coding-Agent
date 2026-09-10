import { parseMentionQuery, rankMentionCandidates } from '../core/mention-match';
import { parseSlashQuery } from '../core/slash-command';

import type {
  MentionIndexPort,
  MentionSuggestions,
  SkillListPort,
} from './mention-suggestion.types';

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
  constructor(
    private readonly index: MentionIndexPort,
    private readonly skills: SkillListPort,
  ) {}

  /**
   * Commands whose name starts with what was typed.
   *
   * Prefix rather than the subsequence matching mentions use: a command is
   * a name someone chose and typed deliberately, and offering `deploy` for
   * `dp` would put a destructive command one Enter away from a typo.
   */
  private async commandSuggestions(query: string, caretIndex: number): Promise<MentionSuggestions> {
    const skills = await this.skills.list();
    return {
      start: 0,
      end: caretIndex,
      paths: skills
        .filter((skill) => skill.name.startsWith(query))
        .map((skill) => `/${skill.name}`),
    };
  }

  async suggest(text: string, caretIndex: number): Promise<MentionSuggestions> {
    // A slash command is completed by the same list, from the same seam. Two
    // popups would be two places to fix the day either one changed.
    const command = parseSlashQuery(text, caretIndex);
    if (command !== undefined) return this.commandSuggestions(command, caretIndex);
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
