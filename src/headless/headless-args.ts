import path from 'node:path';

import {
  HEADLESS_BARE_FLAGS,
  HEADLESS_OUTPUT_FORMATS,
  HEADLESS_TOOL_CATEGORIES,
  HEADLESS_VALUE_FLAGS,
} from './headless-args.constants';

import type {
  HeadlessEnvironment,
  HeadlessInvocation,
  HeadlessOutputFormat,
  HeadlessParse,
} from './headless-args.types';
import type { AgentAuth } from '../sdk/create-agent.types';
import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

/**
 * Reads an invocation, and names the mistake rather than guessing.
 *
 * A headless runner that invents a default for a missing prompt does the wrong
 * work silently, so every problem here is a `usage` result — exit 2 — before a
 * single request is made. `--json` is kept as the older spelling of
 * `--output-format json`, and `--prompt` of `-p`.
 */
export function parseHeadlessArgs(
  argv: readonly string[],
  environment: HeadlessEnvironment,
  cwd: string,
): HeadlessParse {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index] ?? '';
    const field = HEADLESS_VALUE_FLAGS[entry];
    if (field === undefined) {
      if (!HEADLESS_BARE_FLAGS.includes(entry)) {
        return { kind: 'usage', message: `Unknown argument: ${entry}` };
      }
      flags.add(entry);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || isFlag(value)) {
      return { kind: 'usage', message: `${entry} needs a value.` };
    }
    values.set(field, [...(values.get(field) ?? []), value]);
    index += 1;
  }
  if (flags.has('-h') || flags.has('--help')) return { kind: 'help' };
  return invocationFrom(values, flags.has('--json'), environment, cwd);
}

function invocationFrom(
  values: ReadonlyMap<string, readonly string[]>,
  json: boolean,
  environment: HeadlessEnvironment,
  cwd: string,
): HeadlessParse {
  const last = (field: string): string | undefined => values.get(field)?.at(-1);
  const checked = checkedFields(last, json);
  if (typeof checked === 'string') return { kind: 'usage', message: checked };
  return {
    kind: 'run',
    invocation: {
      ...checked,
      workspace: path.resolve(cwd, last('workspace') ?? '.'),
      model: last('model') ?? environment.CLAW_MODEL ?? environment.CLAW_LIVE_MODEL,
      provider: last('provider') ?? environment.CLAW_PROVIDER ?? environment.CLAW_LIVE_PROVIDER,
      backendUrl:
        last('backendUrl') ?? environment.CLAW_BACKEND_URL ?? environment.CLAW_LIVE_BACKEND_URL,
      allowCommands: values.get('allowCommand') ?? [],
    },
  };
}

/** The fields that can be wrong, validated; a string names the first mistake. */
function checkedFields(
  last: (field: string) => string | undefined,
  json: boolean,
): Pick<HeadlessInvocation, 'prompt' | 'outputFormat' | 'allowTools' | 'maxTurns'> | string {
  const prompt = last('prompt');
  if (prompt === undefined || prompt.trim().length === 0) {
    return 'A prompt is required: -p "<task>".';
  }
  const outputFormat = last('outputFormat') ?? (json ? 'json' : 'text');
  if (!isOutputFormat(outputFormat)) {
    return '--output-format must be one of text, json, stream-json.';
  }
  const allowTools = parseToolList(last('allowTools'));
  if (typeof allowTools === 'string') return allowTools;
  const maxTurns = parseMaxTurns(last('maxTurns'));
  if (typeof maxTurns === 'string') return maxTurns;
  return { prompt, outputFormat, allowTools, maxTurns };
}

/** The granted categories, or the message naming the one that is not a category. */
export function parseToolList(raw: string | undefined): readonly AgentToolCategory[] | string {
  if (raw === undefined) return ['read', 'git'];
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const categories: AgentToolCategory[] = [];
  for (const name of names) {
    const category = HEADLESS_TOOL_CATEGORIES.find((candidate) => candidate === name);
    if (category === undefined) {
      return `Unknown tool category "${name}". Use ${HEADLESS_TOOL_CATEGORIES.join(', ')}.`;
    }
    categories.push(category);
  }
  return categories;
}

export function parseMaxTurns(raw: string | undefined): number | undefined | string {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    return '--max-turns must be a whole number from 1 to 1000.';
  }
  return value;
}

/** A value that is itself a flag means the real value was forgotten. */
function isFlag(value: string): boolean {
  return HEADLESS_VALUE_FLAGS[value] !== undefined || HEADLESS_BARE_FLAGS.includes(value);
}

function isOutputFormat(value: string): value is HeadlessOutputFormat {
  return HEADLESS_OUTPUT_FORMATS.some((format) => format === value);
}

/**
 * The credential from the environment, or nothing.
 *
 * A token wins over email and password when both are set: it is the narrower
 * grant. The older `CLAW_LIVE_*` names are still read so existing pipelines
 * keep working.
 */
export function authFromEnvironment(environment: HeadlessEnvironment): AgentAuth | undefined {
  const token = environment.CLAW_TOKEN;
  if (token !== undefined && token.length > 0) return { token };
  const email = environment.CLAW_EMAIL ?? environment.CLAW_LIVE_EMAIL;
  const password = environment.CLAW_PASSWORD ?? environment.CLAW_LIVE_PASSWORD;
  if (email === undefined || password === undefined) return undefined;
  if (email.length === 0 || password.length === 0) return undefined;
  return { email, password };
}
