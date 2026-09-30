import {
  AGENT_INSTRUCTIONS_CLOSE,
  AGENT_INSTRUCTIONS_OPEN,
  AGENT_MAX_SYSTEM_PROMPT_CHARS,
  AGENT_MAX_TOOL_PATTERNS,
  AGENT_MAX_TOOL_PATTERN_CHARS,
  AGENT_REDACTED_PROMPT_MARK,
  AGENT_THREAD_ID_PATTERN,
} from './agent-inputs.constants';
import { writeScopeProblem } from './write-scope';

/** The message naming what is wrong with a thread identifier, or undefined when it is fine. */
export function threadIdProblem(threadId: string): string | undefined {
  return AGENT_THREAD_ID_PATTERN.test(threadId)
    ? undefined
    : 'A thread id is 1 to 128 letters, digits, underscores or dashes.';
}

/** The message naming what is wrong with operator instructions, or undefined when they are fine. */
export function systemPromptProblem(text: string): string | undefined {
  if (text.trim().length === 0) return 'The system prompt is empty.';
  if (text.length > AGENT_MAX_SYSTEM_PROMPT_CHARS) {
    return `The system prompt is longer than ${String(AGENT_MAX_SYSTEM_PROMPT_CHARS)} characters.`;
  }
  return undefined;
}

/** The message naming what is wrong with a tool pattern list, or undefined. */
export function toolPatternsProblem(patterns: readonly string[]): string | undefined {
  if (patterns.length > AGENT_MAX_TOOL_PATTERNS) {
    return `At most ${String(AGENT_MAX_TOOL_PATTERNS)} tool patterns are allowed.`;
  }
  const badLength = (pattern: string): boolean =>
    pattern.length === 0 || pattern.length > AGENT_MAX_TOOL_PATTERN_CHARS;
  if (patterns.some(badLength)) {
    return `A tool pattern is 1 to ${String(AGENT_MAX_TOOL_PATTERN_CHARS)} characters.`;
  }
  return undefined;
}

/**
 * The prompt the runtime receives. The run API has no system-prompt field, so
 * operator instructions travel as a framed block ahead of the task; they add to
 * the runtime's own instructions and cannot replace them.
 */
export function promptWithInstructions(prompt: string, systemPrompt: string | undefined): string {
  if (systemPrompt === undefined) return prompt;
  return `${AGENT_INSTRUCTIONS_OPEN}\n${systemPrompt}\n${AGENT_INSTRUCTIONS_CLOSE}\n\n${prompt}`;
}

/** A message with the instruction text removed, in case an error echoed the prompt. */
export function withoutInstructions(message: string, systemPrompt: string | undefined): string {
  if (systemPrompt === undefined || systemPrompt.length < 4) return message;
  return message.split(systemPrompt).join(AGENT_REDACTED_PROMPT_MARK);
}

function permissionsProblem(
  permissions:
    | { writeScope?: readonly string[] | undefined; writeDeny?: readonly string[] | undefined }
    | undefined,
): string | undefined {
  return writeScopeProblem(permissions?.writeScope ?? [], permissions?.writeDeny ?? []);
}

/** Throws when an option is unusable, so a bad value fails at `createAgent`, not mid-run. */
export function assertAgentInputs(config: {
  readonly threadId?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly allowedTools?: readonly string[] | undefined;
  readonly disallowedTools?: readonly string[] | undefined;
  readonly permissions?:
    | {
        readonly writeScope?: readonly string[] | undefined;
        readonly writeDeny?: readonly string[] | undefined;
      }
    | undefined;
}): void {
  const problem =
    (config.threadId === undefined ? undefined : threadIdProblem(config.threadId)) ??
    (config.systemPrompt === undefined ? undefined : systemPromptProblem(config.systemPrompt)) ??
    toolPatternsProblem(config.allowedTools ?? []) ??
    toolPatternsProblem(config.disallowedTools ?? []) ??
    permissionsProblem(config.permissions);
  if (problem !== undefined) throw new RangeError(problem);
}
