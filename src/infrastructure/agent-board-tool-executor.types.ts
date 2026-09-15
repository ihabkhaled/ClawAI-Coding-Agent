import type { AgentBoard } from '../core/agent-board.types';

/**
 * The board one graph shares.
 *
 * Held by the coordinator rather than globally, because two unrelated graphs
 * must not read each other's notes: a board is a record of one piece of work,
 * and mixing two makes every note ambiguous about which run it belongs to.
 */
export interface AgentBoardPort {
  read(): AgentBoard;
  write(board: AgentBoard): void;
  /** Which task is calling, which the caller cannot be trusted to state. */
  callerTaskId(): string;
}
