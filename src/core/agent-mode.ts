import type { AgentMode } from './agent-mode.types';

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
