import type { AgentRunPhase } from './agent-run';

/**
 * One line a run terminal has earned the right to print.
 *
 * Structured rather than formatted: the core decides what changed, the adapter
 * decides what that reads like in the reader's language. A core that returned
 * English sentences would either import the extension host or ship a second
 * untranslated surface.
 */
export type TerminalRunLine =
  | { kind: 'phase'; phase: AgentRunPhase }
  | { kind: 'file'; operation: string; path: string }
  | { kind: 'command'; command: string; purpose: string }
  | { kind: 'summary'; text: string };
