import type { AgentToolCategory } from './workspace-toolkit.types';

/** The longest text of one note. */
export const NOTE_MAX_TEXT_CHARS = 2_000;

/** The longest tag. */
export const NOTE_MAX_TAG_CHARS = 32;

/** The most notes one conversation keeps. */
export const NOTES_MAX_COUNT = 200;

/** The most bytes of notes one conversation keeps. */
export const NOTES_MAX_BYTES = 64 * 1024;

/** The most characters `read` returns; older notes are left out first. */
export const NOTES_READ_MAX_CHARS = 24_000;

/** The most characters of notes carried into a continuation or resume prompt. */
export const NOTES_PROMPT_MAX_CHARS = 8_000;

/** Where the notes live under the state directory. */
export const NOTES_DIRECTORY_NAME = 'notes';

/** The heading the notes carry in a prompt. */
export const NOTES_PROMPT_HEADING = 'Your notes so far:';

/** The thread key used while no thread exists yet. */
export const NOTES_NO_THREAD = 'no-thread';

/** Every notes operation only touches the agent's own memory, so it is `read`. */
export const NOTES_TOOL_OPERATIONS: Readonly<Record<string, AgentToolCategory>> = {
  add: 'read',
  read: 'read',
  replace: 'read',
  remove: 'read',
  clear: 'read',
};

/** What the model is told: earlier tool results are condensed, so write down what it will need. */
export const NOTES_TOOL_DESCRIPTION =
  'Your working memory. Your earlier tool results are condensed after a while: right after reading ' +
  'something you will need later (file structure, exact names/paths, decisions, gate results, TODOs), ' +
  'add a short note; call read to recall instead of re-reading files. ' +
  `add {text (<=${String(NOTE_MAX_TEXT_CHARS)} chars), tag? (<=${String(NOTE_MAX_TAG_CHARS)})}; ` +
  'read {tag?, query?} returns every note (or the matching ones), numbered, newest last; ' +
  'replace {id, text} rewrites a note; remove {id}; clear drops all. ' +
  `At most ${String(NOTES_MAX_COUNT)} notes. Never note secrets. Notes are kept outside the workspace and survive a resume.`;

/** One schema for the five operations. */
export const NOTES_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: {
      type: 'string',
      maxLength: NOTE_MAX_TEXT_CHARS,
      description: 'add, replace: the note.',
    },
    tag: {
      type: 'string',
      maxLength: NOTE_MAX_TAG_CHARS,
      description: 'add: a short label. read: only notes with this tag.',
    },
    query: {
      type: 'string',
      maxLength: 200,
      description: 'read: only notes containing this text.',
    },
    id: { type: 'integer', minimum: 1, description: 'replace, remove: the note number.' },
  },
} as const;
