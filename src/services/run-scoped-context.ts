import { EMPTY_BOARD } from '../core/agent-board';

import type { AgentBoard } from '../core/agent-board.types';
import type { AgentRunSnapshot } from '../core/agent-run';
import type { ExtensionSnapshot } from '../core/extension-state';
import type { RunGoal } from '../core/run-goal.types';
import type { ParentRunContext } from '../core/sub-agent-inheritance.types';

/**
 * What one run accumulates that is not a file, and what clears it.
 *
 * The note board and the declared goal are the same kind of thing: both are
 * true about one piece of work in one workspace, and both become misleading
 * rather than merely stale when the workspace changes. A goal names checks
 * about files, and the same checks against a different tree are checks about
 * nothing; a board mixed across two graphs makes every note ambiguous about
 * which run it belongs to.
 *
 * Keeping them together means there is one place that knows what a workspace
 * change invalidates, instead of two fields that have to be remembered
 * separately every time a third is added.
 */
export class RunScopedContext {
  private boardValue: AgentBoard = EMPTY_BOARD;
  private goalValue: RunGoal | undefined;

  board(): AgentBoard {
    return this.boardValue;
  }

  setBoard(board: AgentBoard): void {
    this.boardValue = board;
  }

  goal(): RunGoal | undefined {
    return this.goalValue;
  }

  setGoal(goal: RunGoal): void {
    this.goalValue = goal;
  }

  /**
   * The board as a port, so callers cannot hold the value and write a stale one
   * back. Every read goes through this object, which is what keeps one graph's
   * notes out of the next graph's reads.
   */
  boardPort(): { read: () => AgentBoard; write: (board: AgentBoard) => void } {
    return {
      read: () => this.boardValue,
      write: (board) => {
        this.boardValue = board;
      },
    };
  }

  goalPort(): { read: () => RunGoal | undefined; write: (goal: RunGoal) => void } {
    return {
      read: () => this.goalValue,
      write: (goal) => {
        this.goalValue = goal;
      },
    };
  }

  clear(): void {
    this.boardValue = EMPTY_BOARD;
    this.goalValue = undefined;
  }
}

/**
 * What a child that asked to inherit context gets to know.
 *
 * Built at launch rather than captured once, so a child started later in the
 * run sees the decisions the parent made in the meantime — which is the whole
 * reason a graph runs in stages. The goal comes from the prompt the run is
 * executing, because that is the only place it exists.
 */
export function parentRunContext(
  prompt: string,
  snapshot: ExtensionSnapshot,
  run: AgentRunSnapshot | undefined,
): ParentRunContext {
  return {
    goal: prompt,
    decisions: run?.summary === undefined ? [] : [run.summary],
    changedPaths: run?.files.map((file) => file.path) ?? [],
    findings: snapshot.findings,
  };
}
