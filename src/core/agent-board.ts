import { MAX_BOARD_NOTES, MAX_NOTE_LENGTH, MAX_NOTES_PER_AGENT } from './agent-board.constants';
import { redactText } from './redaction';

import type {
  AgentBoard,
  AgentBoardPostResult,
  AgentNote,
  AgentNoteKind,
} from './agent-board.types';

export const EMPTY_BOARD: AgentBoard = { notes: [] };

/**
 * Adds one note to the shared board, or says why it could not.
 *
 * Steering has always been parent to child: a coordinator could tell an agent
 * something, and an agent could tell nobody. Two agents editing adjacent code
 * could not warn each other, and the only way one learned what another found
 * was for both to finish and the parent to read both reports.
 *
 * A refusal names the limit that stopped it. "Your quota is full" and "the
 * board is full" call for different responses — the first means post less, the
 * second means the run has produced more notes than anyone will read — and an
 * agent told only "no" will retry the same note.
 *
 * A duplicate is refused rather than appended. Two agents reaching the same
 * conclusion is common and worth knowing once; the second copy costs every
 * later reader and tells them nothing.
 */
export function postNote(
  board: AgentBoard,
  taskId: string,
  kind: AgentNoteKind,
  text: string,
): AgentBoardPostResult {
  const clean = redactText(text.trim()).slice(0, MAX_NOTE_LENGTH);
  if (board.notes.length >= MAX_BOARD_NOTES) {
    return { posted: false, reason: 'board-full' };
  }
  if (board.notes.filter((note) => note.taskId === taskId).length >= MAX_NOTES_PER_AGENT) {
    return { posted: false, reason: 'agent-quota' };
  }
  if (board.notes.some((note) => note.kind === kind && note.text === clean)) {
    return { posted: false, reason: 'duplicate' };
  }
  const sequence = (board.notes.at(-1)?.sequence ?? 0) + 1;
  const note: AgentNote = { taskId, kind, text: clean, sequence };
  return { posted: true, board: { notes: [...board.notes, note] }, sequence };
}

/**
 * What one agent has not already seen.
 *
 * Its own notes are left out. A board exists to carry what you did not know,
 * and handing an agent its own writing back spends its context on the one thing
 * it is certain of. `since` lets a long-running agent read only what has
 * appeared since it last looked, so checking the board repeatedly costs little.
 */
export function notesForReader(
  board: AgentBoard,
  readerTaskId: string,
  since = 0,
): readonly AgentNote[] {
  return board.notes.filter((note) => note.taskId !== readerTaskId && note.sequence > since);
}

/** Every note, oldest first — what the parent reads when the graph is done. */
export function boardDigest(board: AgentBoard): readonly AgentNote[] {
  return board.notes;
}
