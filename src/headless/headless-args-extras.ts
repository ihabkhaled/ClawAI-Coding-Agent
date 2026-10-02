import path from 'node:path';

import { threadIdProblem, toolPatternsProblem } from '../sdk/agent-inputs';
import { maxAgentsProblem } from '../sdk/agent-team-args';
import { parseAllowHosts } from '../sdk/browser-tool-url';
import { parseGateNames } from '../sdk/code-gates-done-checks';
import { parseHostRules } from '../sdk/http-host-rules';
import { AGENT_PERMISSION_MODES } from '../sdk/permission-modes.constants';
import { writeScopeProblem } from '../sdk/write-scope';

import { checkedControls } from './headless-args-controls';
import { planFlags } from './headless-args-plan';
import { visionFlags } from './headless-args-vision';
import { parseDoneCheckFlags } from './headless-done-checks';

import type { HeadlessInvocation } from './headless-args.types';
import type { AgentPermissionMode } from '../sdk/permission-modes.types';

type Values = ReadonlyMap<string, readonly string[]>;
type Flags = ReadonlySet<string>;
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
    | 'useMemory'
    | 'writeScope'
    | 'writeDeny'
    | 'httpAllowHosts'
    | 'doneChecks'
    | 'doneCheckFile'
    | 'planFile'
    | 'requirePlan'
    | 'taskPlan'
    | 'doneCheckGates'
    | 'effort'
    | 'speed'
    | 'context'
    | 'research'
    | 'browserAllowHosts'
    | 'loadKnowledge'
    | 'images'
    | 'visionModel'
    | 'vision'
    | 'maxAgents'
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

function memoryFlags(flags: Flags): Extras | string {
  if (flags.has('--use-memory') && flags.has('--no-memory')) {
    return '--use-memory and --no-memory cannot be combined.';
  }
  return flags.has('--use-memory') ? { useMemory: true } : {};
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

function scopeFlags(values: Values): Extras | string {
  const scope = splitPatterns(values.get('writeScope'));
  const deny = splitPatterns(values.get('writeDeny'));
  const problem = writeScopeProblem(scope, deny);
  if (problem !== undefined) return `--write-scope/--write-deny: ${problem}`;
  return {
    ...(scope.length === 0 ? {} : { writeScope: scope }),
    ...(deny.length === 0 ? {} : { writeDeny: deny }),
  };
}

function httpFlags(values: Values): Extras | string {
  const hosts = splitPatterns(values.get('httpAllowHost'));
  const rules = parseHostRules(hosts);
  if (typeof rules === 'string') return `--http-allow-host: ${rules}`;
  return hosts.length === 0 ? {} : { httpAllowHosts: hosts };
}

function browserFlags(values: Values): Extras | string {
  try {
    const hosts = parseAllowHosts(values.get('browserAllowHost') ?? []);
    return hosts.length === 0 ? {} : { browserAllowHosts: hosts };
  } catch (error) {
    return error instanceof Error ? error.message : '--browser-allow-host is not valid.';
  }
}

function agentFlags(values: Values): Extras | string {
  const raw = lastOf(values, 'maxAgents');
  if (raw === undefined) return {};
  const value = Number(raw);
  const problem = maxAgentsProblem(Number.isNaN(value) ? undefined : value);
  if (Number.isNaN(value) || problem !== undefined)
    return '--max-agents must be a whole number from 1 to 8.';
  return { maxAgents: value };
}

function doneFlags(values: Values, cwd: string): Extras | string {
  const raw = values.get('doneCheck') ?? [];
  const checks = parseDoneCheckFlags(raw);
  if (typeof checks === 'string') return checks;
  const file = lastOf(values, 'doneCheckFile');
  const gateValues = values.get('doneCheckGates');
  const gates = gateValues === undefined ? [] : parseGateNames(gateValues);
  if (typeof gates === 'string') return gates;
  return {
    ...(gates.length === 0 ? {} : { doneCheckGates: gates }),
    ...(checks.length === 0 ? {} : { doneChecks: checks }),
    ...(file === undefined ? {} : { doneCheckFile: path.resolve(cwd, file) }),
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
export function checkedExtras(values: Values, flags: Flags, cwd: string): Extras | string {
  const session = sessionFlags(values, flags.has('--continue'));
  if (typeof session === 'string') return session;
  const memory = memoryFlags(flags);
  if (typeof memory === 'string') return memory;
  const policy = policyFlags(values);
  if (typeof policy === 'string') return policy;
  const scope = scopeFlags(values);
  if (typeof scope === 'string') return scope;
  const http = httpFlags(values);
  if (typeof http === 'string') return http;
  const done = doneFlags(values, cwd);
  if (typeof done === 'string') return done;
  const controls = checkedControls(values);
  if (typeof controls === 'string') return controls;
  const browser = browserFlags(values);
  if (typeof browser === 'string') return browser;
  const vision = visionFlags(values, flags, cwd);
  if (typeof vision === 'string') return vision;
  const agents = agentFlags(values);
  if (typeof agents === 'string') return agents;
  return {
    ...vision,
    ...agents,
    ...session,
    ...memory,
    ...policy,
    ...scope,
    ...http,
    ...done,
    ...planFlags(values, flags, cwd),
    ...controls,
    ...browser,
    ...(flags.has('--load-knowledge') ? { loadKnowledge: true as const } : {}),
    ...fileFlags(values, cwd),
  };
}
