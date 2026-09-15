import type { OutputStyle, OutputStyleDefinition } from './output-style.types';

/**
 * The styles that ship with the extension.
 *
 * Preambles are sent to the model, not shown to the user, so they stay in
 * English whatever the interface language is: the instruction and the prompt
 * it modifies have to be in one language for the model to read them as one
 * instruction. Only the labels in the picker are translated.
 *
 * `default` carries no preamble at all rather than an empty one. A style that
 * said "answer normally" would be spending tokens to ask for the behaviour
 * that already happens.
 */
export const BUILT_IN_OUTPUT_STYLES: readonly OutputStyleDefinition[] = [
  { name: 'default', preamble: '' },
  {
    name: 'concise',
    preamble:
      'Answer in as few words as the question allows. Lead with the answer, omit preamble ' +
      'and restatement, and keep code samples to the lines that changed.',
  },
  {
    name: 'explanatory',
    preamble:
      'Explain the reasoning behind what you do, not only the result. Say why an approach ' +
      'was chosen over the alternatives, and name the tradeoff when there is one.',
  },
  {
    name: 'learning',
    preamble:
      'Teach while you work. Define the unfamiliar terms you use, point out the general ' +
      'pattern behind the specific fix, and suggest what to read or try next.',
  },
];

/** Reads a stored or user-supplied style, defaulting to no style at all. */
export function normalizeOutputStyle(value: unknown): OutputStyle {
  return typeof value === 'string' && value.length > 0 ? value : 'default';
}

/**
 * The instruction a style adds, or nothing.
 *
 * Workspace styles are looked up before the built-ins so a project can replace
 * `concise` with its own idea of concise. A named style that no longer exists
 * adds nothing rather than failing the send: styles live in files that can be
 * deleted while a setting still points at them.
 */
export function outputStylePreamble(
  style: OutputStyle,
  workspaceStyles: readonly OutputStyleDefinition[] = [],
): string {
  const found =
    workspaceStyles.find((candidate) => candidate.name === style) ??
    BUILT_IN_OUTPUT_STYLES.find((candidate) => candidate.name === style);
  return found?.preamble.trim() ?? '';
}
