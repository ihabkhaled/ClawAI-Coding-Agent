import { applyAgentModeToPrompt } from './agent-mode';

import type { PromptComposition } from './prompt-composition.types';

/**
 * The prompt as the model will see it.
 *
 * One place, because there are two send paths — the legacy chat path and
 * Runtime V2 — and a prompt assembled differently by each is a prompt whose
 * behaviour depends on which transport happened to be selected.
 *
 * Order is a decision. The Plan-mode instruction comes first because it is a
 * constraint on what may happen; the style comes second because it is a
 * preference about how to say it. A style that could be read as loosening the
 * constraint has already been overruled by the time it is read.
 */
export function composePrompt(input: PromptComposition): string {
  const styled =
    input.stylePreamble.length === 0 ? input.content : `${input.stylePreamble}\n\n${input.content}`;
  return applyAgentModeToPrompt(input.agentMode, styled);
}
