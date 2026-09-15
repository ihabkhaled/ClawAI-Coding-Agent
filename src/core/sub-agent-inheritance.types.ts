import type { Finding } from './findings';

/**
 * How much of the parent run a child starts with.
 *
 * `none` is the default and is what every sub-agent got before this existed: a
 * goal, a write set and a worktree, and nothing about why it was asked.
 */
export type SubAgentInheritance = 'none' | 'summary' | 'findings';

/** What the parent can pass down, before any of it is bounded or redacted. */
export interface ParentRunContext {
  /** What the parent was asked to do. */
  readonly goal: string;
  /** Decisions the parent has already made and does not want relitigated. */
  readonly decisions: readonly string[];
  /** Paths the parent has already changed, so a child does not rediscover them. */
  readonly changedPaths: readonly string[];
  readonly findings: readonly Finding[];
}
