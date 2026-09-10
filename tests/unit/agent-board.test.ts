import { describe, expect, it, vi } from 'vitest';

import { EMPTY_BOARD, notesForReader, postNote } from '../../src/core/agent-board';
import { MAX_BOARD_NOTES, MAX_NOTES_PER_AGENT } from '../../src/core/agent-board.constants';
import {
  AgentBoardToolExecutor,
  agentBoardToolDefinition,
} from '../../src/infrastructure/agent-board-tool-executor';

import type { AgentBoard } from '../../src/core/agent-board.types';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return { toolName: agentBoardToolDefinition.name, operation, arguments: args } as ToolInvocation;
}

function boardWith(count: number, taskId: string): AgentBoard {
  let board = EMPTY_BOARD;
  for (let index = 0; index < count; index += 1) {
    const result = postNote(board, taskId, 'finding', `note ${String(index)}`);
    if (result.posted) board = result.board;
  }
  return board;
}

describe('postNote', () => {
  it('accepts a note and gives it a sequence a reader can resume from', () => {
    const result = postNote(EMPTY_BOARD, 'explorer-1', 'finding', 'The parser is hand-rolled');

    expect(result).toMatchObject({ posted: true, sequence: 1 });
  });

  it('redacts a secret an agent quoted out of a file', () => {
    const result = postNote(
      EMPTY_BOARD,
      'a',
      'warning',
      'config has Authorization: Bearer sk-live-9',
    );

    expect(result.posted).toBe(true);
    if (result.posted) {
      expect(result.board.notes[0]?.text).not.toContain('sk-live-9');
    }
  });

  it('refuses a second copy of the same note rather than appending it', () => {
    const first = postNote(EMPTY_BOARD, 'a', 'finding', 'same');
    const board = first.posted ? first.board : EMPTY_BOARD;

    expect(postNote(board, 'b', 'finding', 'same')).toEqual({
      posted: false,
      reason: 'duplicate',
    });
  });

  it('stops one agent at its quota without stopping the others', () => {
    const board = boardWith(MAX_NOTES_PER_AGENT, 'loud');

    expect(postNote(board, 'loud', 'finding', 'one more')).toEqual({
      posted: false,
      reason: 'agent-quota',
    });
    expect(postNote(board, 'quiet', 'finding', 'my turn').posted).toBe(true);
  });

  it('names which limit stopped it, since the two need different answers', () => {
    let board = EMPTY_BOARD;
    for (let agent = 0; agent < MAX_BOARD_NOTES / MAX_NOTES_PER_AGENT; agent += 1) {
      for (let index = 0; index < MAX_NOTES_PER_AGENT; index += 1) {
        const result = postNote(
          board,
          `agent-${String(agent)}`,
          'finding',
          `n${String(agent)}-${String(index)}`,
        );
        if (result.posted) board = result.board;
      }
    }

    expect(board.notes).toHaveLength(MAX_BOARD_NOTES);
    expect(postNote(board, 'newcomer', 'finding', 'late')).toEqual({
      posted: false,
      reason: 'board-full',
    });
  });
});

describe('notesForReader', () => {
  it('leaves out the reader own notes, which it is already certain of', () => {
    let board = EMPTY_BOARD;
    const mine = postNote(board, 'me', 'finding', 'mine');
    board = mine.posted ? mine.board : board;
    const theirs = postNote(board, 'them', 'warning', 'theirs');
    board = theirs.posted ? theirs.board : board;

    expect(notesForReader(board, 'me').map((note) => note.text)).toEqual(['theirs']);
  });

  it('returns only what has appeared since the reader last looked', () => {
    let board = EMPTY_BOARD;
    for (const text of ['one', 'two', 'three']) {
      const result = postNote(board, 'them', 'finding', text);
      board = result.posted ? result.board : board;
    }

    expect(notesForReader(board, 'me', 2).map((note) => note.text)).toEqual(['three']);
  });
});

describe('AgentBoardToolExecutor', () => {
  function harness(taskId: string) {
    let board = EMPTY_BOARD;
    const executor = new AgentBoardToolExecutor({
      read: () => board,
      write: (next) => {
        board = next;
      },
      callerTaskId: () => taskId,
    });
    return { executor, board: () => board };
  }

  it('attributes a note to the calling task, not to whatever it claims', async () => {
    const seat = harness('security-reviewer');
    await seat.executor.execute(
      invocation('post', { kind: 'warning', text: 'unsafe', taskId: 'someone-else' }),
    );

    expect(seat.board().notes[0]?.taskId).toBe('security-reviewer');
  });

  it('reports a refused post rather than ending the run over a note', async () => {
    const seat = harness('a');
    for (let index = 0; index < MAX_NOTES_PER_AGENT; index += 1) {
      await seat.executor.execute(
        invocation('post', { kind: 'finding', text: `n${String(index)}` }),
      );
    }

    const output = await seat.executor.execute(
      invocation('post', { kind: 'finding', text: 'over' }),
    );

    expect(output.structured).toEqual({ posted: false, reason: 'agent-quota' });
  });

  it('reads other agents notes and reports how far it got', async () => {
    let board = EMPTY_BOARD;
    const posted = postNote(board, 'other', 'claim', 'taking src/a.ts');
    board = posted.posted ? posted.board : board;
    const executor = new AgentBoardToolExecutor({
      read: () => board,
      write: vi.fn(),
      callerTaskId: () => 'me',
    });

    const output = await executor.execute(invocation('read', {}));

    expect(output.structured).toEqual({
      notes: [{ from: 'other', kind: 'claim', text: 'taking src/a.ts', sequence: 1 }],
      latest: 1,
    });
  });

  it('is an inspect-class tool, because a note changes no file', () => {
    expect(agentBoardToolDefinition.riskClasses).toEqual(['inspect']);
  });
});
