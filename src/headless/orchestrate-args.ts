import path from 'node:path';

import { parseHostRules } from '../sdk/http-host-rules';
import { ORCHESTRATE_DEFAULT_CEILING } from '../sdk/orchestrate-plan.constants';
import { AGENT_PERMISSION_MODES } from '../sdk/permission-modes.constants';

import { parseToolList } from './headless-args';
import { splitPatterns } from './headless-args-extras';
import {
  ORCHESTRATE_BARE_FLAGS,
  ORCHESTRATE_OUTPUT_FORMATS,
  ORCHESTRATE_VALUE_FLAGS,
} from './orchestrate-cli.constants';

import type { HeadlessEnvironment, HeadlessOutputFormat } from './headless-args.types';
import type { AgentPermissionMode } from '../sdk/permission-modes.types';
import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

/** What `clawai orchestrate` was asked, decided before anything is read or started. */
export interface OrchestrateInvocation {
  /** The plan file, resolved against the working directory. */
  readonly planFile: string;
  readonly dryRun: boolean;
  readonly model: string | undefined;
  readonly provider: string | undefined;
  readonly backendUrl: string | undefined;
  readonly allowTools: readonly AgentToolCategory[];
  readonly allowCommands: readonly string[];
  readonly httpAllowHosts: readonly string[];
  readonly browserAllowHosts: readonly string[];
  readonly allowShell: boolean;
  readonly shellDeny: readonly string[];
  readonly permissionMode: AgentPermissionMode | undefined;
  readonly maxParallel: number | undefined;
  readonly outputFormat: HeadlessOutputFormat;
}

export type OrchestrateParse =
  | { readonly kind: 'help' }
  | { readonly kind: 'usage'; readonly message: string }
  | { readonly kind: 'run'; readonly invocation: OrchestrateInvocation };

type Values = ReadonlyMap<string, readonly string[]>;

function isFlag(value: string): boolean {
  return ORCHESTRATE_VALUE_FLAGS[value] !== undefined || ORCHESTRATE_BARE_FLAGS.includes(value);
}

/** The flags as values by field and a set of bare flags, or the first mistake. */
function collect(argv: readonly string[]): { values: Values; flags: ReadonlySet<string> } | string {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index] ?? '';
    const field = ORCHESTRATE_VALUE_FLAGS[entry];
    if (field === undefined) {
      if (!ORCHESTRATE_BARE_FLAGS.includes(entry)) return `Unknown argument: ${entry}`;
      flags.add(entry);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || isFlag(value)) return `${entry} needs a value.`;
    values.set(field, [...(values.get(field) ?? []), value]);
    index += 1;
  }
  return { values, flags };
}

function defaultTools(values: Values): readonly AgentToolCategory[] {
  return [
    ...ORCHESTRATE_DEFAULT_CEILING,
    ...(values.has('httpAllowHost') ? (['http'] as const) : []),
    ...(values.has('browserAllowHost') ? (['browser'] as const) : []),
  ];
}

function shellProblem(
  tools: readonly AgentToolCategory[],
  allowShell: boolean,
  mode: string | undefined,
): string | undefined {
  const named = tools.includes('shell');
  if (named !== allowShell) {
    return named
      ? '--allow-tools shell also needs --allow-shell: the shell is off unless both switches are given.'
      : '--allow-shell also needs shell in --allow-tools.';
  }
  return allowShell && mode === undefined
    ? '--allow-shell needs --permission-mode: every script is put to an approval, and without a mode nothing could approve it.'
    : undefined;
}

interface Fields {
  readonly tools: readonly AgentToolCategory[];
  readonly parallel: number | undefined;
  readonly format: string;
  readonly mode: string | undefined;
}

/** The fields that can be wrong, validated; a string names the first mistake. */
function checkedFields(
  values: Values,
  flags: ReadonlySet<string>,
  allow: string | undefined,
): Fields | string {
  const last = (field: string): string | undefined => values.get(field)?.at(-1);
  const tools = parseToolList(allow, defaultTools(values));
  if (typeof tools === 'string') return tools;
  const format = last('outputFormat') ?? 'text';
  if (!ORCHESTRATE_OUTPUT_FORMATS.includes(format))
    return '--output-format must be one of text, json, stream-json.';
  const mode = last('permissionMode');
  if (mode !== undefined && !AGENT_PERMISSION_MODES.some((known) => known === mode)) {
    return `--permission-mode must be one of ${AGENT_PERMISSION_MODES.join(', ')}.`;
  }
  const parallel = numberProblem(last('maxParallel'));
  if (typeof parallel === 'string') return parallel;
  const http = parseHostRules(values.get('httpAllowHost') ?? []);
  if (typeof http === 'string') return http;
  return shellProblem(tools, flags.has('--allow-shell'), mode) ?? { tools, parallel, format, mode };
}

function numberProblem(raw: string | undefined): number | undefined | string {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 8
    ? value
    : '--max-parallel is a whole number from 1 to 8.';
}

/** Reads `clawai orchestrate ...` (the arguments after the word `orchestrate`). */
export function parseOrchestrateArgs(
  argv: readonly string[],
  environment: HeadlessEnvironment,
  cwd: string,
): OrchestrateParse {
  const collected = collect(argv);
  if (typeof collected === 'string') return { kind: 'usage', message: collected };
  const { values, flags } = collected;
  if (flags.has('-h') || flags.has('--help')) return { kind: 'help' };
  const last = (field: string): string | undefined => values.get(field)?.at(-1);
  const plan = last('plan');
  if (plan === undefined) return { kind: 'usage', message: '--plan <file> is required.' };
  const checked = checkedFields(values, flags, last('allowTools'));
  if (typeof checked === 'string') return { kind: 'usage', message: checked };
  const { tools, parallel, format, mode } = checked;
  return {
    kind: 'run',
    invocation: {
      planFile: path.resolve(cwd, plan),
      dryRun: flags.has('--dry-run'),
      model: last('model') ?? environment.CLAW_MODEL,
      provider: last('provider') ?? environment.CLAW_PROVIDER,
      backendUrl: last('backendUrl') ?? environment.CLAW_BACKEND_URL,
      allowTools: tools,
      allowCommands: values.get('allowCommand') ?? [],
      httpAllowHosts: splitPatterns(values.get('httpAllowHost')),
      browserAllowHosts: splitPatterns(values.get('browserAllowHost')),
      allowShell: flags.has('--allow-shell'),
      shellDeny: splitPatterns(values.get('shellDeny')),
      permissionMode: AGENT_PERMISSION_MODES.find((known) => known === mode),
      maxParallel: parallel,
      outputFormat: format === 'json' ? 'json' : format === 'stream-json' ? 'stream-json' : 'text',
    },
  };
}
