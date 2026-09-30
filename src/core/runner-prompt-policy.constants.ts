import type { RunnerToolCategory } from './runner-prompt-policy.types';

/** R0/R1: tool categories that read and never change anything. */
export const RUNNER_READ_ONLY_CATEGORIES: readonly RunnerToolCategory[] = ['read', 'git'];

/**
 * Everything a prompt job is offered. Writes and commands are offered so a
 * routine can do real work, but each one waits for local approval.
 */
export const RUNNER_PROMPT_TOOL_CATEGORIES: readonly RunnerToolCategory[] = [
  'read',
  'git',
  'write',
  'command',
];

/** Exit code a prompt job reports when the runner refuses to start it. */
export const RUNNER_PROMPT_REFUSED_EXIT_CODE = 126;
