import type { AgentMode } from './agent-mode.types';

/**
 * The mode a resumed run runs in.
 *
 * Tighten-only, in both directions, because both directions are a way to lose
 * the read-only guarantee by accident. A run that was planning must not start
 * writing because the workspace setting moved while it was parked; and a
 * workspace that has since been switched to Plan must not be overridden by an
 * older Auto run. PLAN is the stricter of the two, so PLAN anywhere wins.
 *
 * A journal written before runs recorded their mode contributes nothing, and
 * the current setting decides alone.
 */
export function resumeAgentMode(
  journalMode: AgentMode | undefined,
  currentMode: AgentMode,
): AgentMode {
  return journalMode === 'PLAN' || currentMode === 'PLAN' ? 'PLAN' : 'AUTO';
}

export function applyAgentModeToPrompt(mode: AgentMode, content: string): string {
  if (mode === 'AUTO') {
    return content;
  }
  return [
    'Plan mode is read-only. Analyze the request and return an implementation plan.',
    'Do not propose that any edits have already been applied.',
    '',
    content,
  ].join('\n');
}
