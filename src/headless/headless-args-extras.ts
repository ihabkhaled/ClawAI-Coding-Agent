import path from 'node:path';

import { threadIdProblem, toolPatternsProblem } from '../sdk/agent-inputs';
import { AGENT_PERMISSION_MODES } from '../sdk/permission-modes.constants';

import type { HeadlessInvocation } from './headless-args.types';
import type { AgentPermissionMode } from '../sdk/permission-modes.types';

type Values = ReadonlyMap<string, readonly string[]>;
type Extras = Partial<
  Pick<
    HeadlessInvocation,
    | 'resume'
    | 'continueLast'
    | 'appendSystemPrompt'
    | 'systemPromptFile'
    | 'mcpConfig'
    | 'permissionMode'
    | 'allowedTools'
    | 'disallowedTools'
  >
>;

/** `a,b` and repeated flags alike, as one list. */
export function splitPatterns(values: readonly string[] | undefined): readonly string[] {
  return (values ?? [])
    .flatMap((value) => value.split(','))
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);
}

function isMode(value: string): value is AgentPermissionMode {
  return AGENT_PERMISSION_MODES.some((mode) => mode === value);
}

const lastOf = (values: Values, field: string): string | undefined => values.get(field)?.at(-1);

function sessionFlags(values: Values, continueLast: boolean): Extras | string {
  const resume = lastOf(values, 'resume');
  if (resume !== undefined && continueLast) return '--resume and --continue cannot be combined.';
  const problem = resume === undefined ? undefined : threadIdProblem(resume);
  if (problem !== undefined) return `--resume: ${problem}`;
  return {
    ...(resume === undefined ? {} : { resume }),
    ...(continueLast ? { continueLast: true as const } : {}),
  };
}

function policyFlags(values: Values): Extras | string {
  const mode = lastOf(values, 'permissionMode');
  if (mode !== undefined && !isMode(mode)) {
    return `--permission-mode must be one of ${AGENT_PERMISSION_MODES.join(', ')}.`;
  }
  const allowed = splitPatterns(values.get('allowedTools'));
  const disallowed = splitPatterns(values.get('disallowedTools'));
  const problem = toolPatternsProblem(allowed) ?? toolPatternsProblem(disallowed);
  if (problem !== undefined) return problem;
  return {
    ...(mode !== undefined && isMode(mode) ? { permissionMode: mode } : {}),
    ...(allowed.length === 0 ? {} : { allowedTools: allowed }),
    ...(disallowed.length === 0 ? {} : { disallowedTools: disallowed }),
  };
}

function fileFlags(values: Values, cwd: string): Extras {
  const append = lastOf(values, 'appendSystemPrompt');
  const promptFile = lastOf(values, 'systemPromptFile');
  const mcp = lastOf(values, 'mcpConfig');
  return {
    ...(append === undefined ? {} : { appendSystemPrompt: append }),
    ...(promptFile === undefined ? {} : { systemPromptFile: path.resolve(cwd, promptFile) }),
    ...(mcp === undefined ? {} : { mcpConfig: path.resolve(cwd, mcp) }),
  };
}

/**
 * The session, instruction, MCP and permission flags, validated.
 *
 * Only flags that were given appear in the result, so an invocation that uses
 * none of them is unchanged. A string is the first mistake found.
 */
export function checkedExtras(values: Values, continueLast: boolean, cwd: string): Extras | string {
  const session = sessionFlags(values, continueLast);
  if (typeof session === 'string') return session;
  const policy = policyFlags(values);
  if (typeof policy === 'string') return policy;
  return { ...session, ...policy, ...fileFlags(values, cwd) };
}
