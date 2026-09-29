/** The angles a multi-agent review can look from, one reviewer each. */
export const REVIEW_DIMENSIONS = ['correctness', 'security', 'tests', 'performance'] as const;

/** Tools a reviewer may use: reading, diffing, symbol lookup, and reporting findings. */
export const REVIEWER_TOOLS = [
  'workspace.files',
  'workspace.git',
  'workspace.intelligence',
  'workspace.quality',
] as const;

/** The diff pasted into a reviewer's goal; the reviewer reads the rest with workspace.git. */
export const MAX_REVIEW_DIFF_CHARS = 12_000;

export const REVIEWER_BUDGET = {
  maxTokens: 400_000,
  maxToolCalls: 60,
  maxRuntimeMs: 900_000,
  maxRetries: 1,
} as const;

/**
 * What each reviewer is told to look for, and what it is told to leave alone.
 *
 * The exclusions matter as much as the focus. Four reviewers with overlapping
 * briefs report the same style nit four times and bury the one real bug.
 */
export const REVIEW_DIMENSION_BRIEFS = {
  correctness: {
    role: 'reviewer',
    focus:
      'Logic errors, wrong conditions, unhandled cases, broken contracts between callers and callees, and data that can reach an invalid state. Leave security, test coverage and speed to the other reviewers.',
  },
  security: {
    role: 'security-reviewer',
    focus:
      'Injection, missing authorization or ownership checks, secrets in code or logs, unsafe deserialization, path traversal and unvalidated input crossing a trust boundary. Report only what an attacker could actually reach.',
  },
  tests: {
    role: 'tester',
    focus:
      'Changed behaviour with no test, tests that cannot fail, assertions that check the mock rather than the code, and missing edge cases the change itself introduced.',
  },
  performance: {
    role: 'reviewer',
    focus:
      'Work repeated inside loops, unbounded queries or collections, N+1 calls, blocking I/O on a hot path and memory that grows without a bound. Ignore micro-optimisations.',
  },
} as const;
