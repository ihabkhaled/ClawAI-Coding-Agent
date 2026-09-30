import path from 'node:path';

import { HEADLESS_MAX_DURATION_SECONDS, HEADLESS_MAX_TOOL_CALLS } from './headless-args.constants';

import type { HeadlessInvocation, HeadlessParse } from './headless-args.types';

type Values = ReadonlyMap<string, readonly string[]>;
type Budgets = Partial<Pick<HeadlessInvocation, 'maxToolCalls' | 'maxDurationMs' | 'mcpTokenFile'>>;

const lastOf = (values: Values, field: string): string | undefined => values.get(field)?.at(-1);

/** A whole number in `1..max`, or undefined when `raw` is not one. */
function wholeNumber(raw: string, max: number): number | undefined {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= max ? value : undefined;
}

/**
 * `--max-tool-calls`, `--max-duration` and `--mcp-token-file`, validated. Only
 * flags that were given appear, so an invocation without them is unchanged. A
 * string is the first mistake found.
 */
export function checkedBudgets(values: Values, cwd: string): Budgets | string {
  const calls = lastOf(values, 'maxToolCalls');
  const seconds = lastOf(values, 'maxDuration');
  const file = lastOf(values, 'mcpTokenFile');
  const maxToolCalls =
    calls === undefined ? undefined : wholeNumber(calls, HEADLESS_MAX_TOOL_CALLS);
  const maxSeconds =
    seconds === undefined ? undefined : wholeNumber(seconds, HEADLESS_MAX_DURATION_SECONDS);
  if (calls !== undefined && maxToolCalls === undefined) {
    return `--max-tool-calls must be a whole number from 1 to ${String(HEADLESS_MAX_TOOL_CALLS)}.`;
  }
  if (seconds !== undefined && maxSeconds === undefined) {
    return `--max-duration must be a whole number of seconds from 1 to ${String(HEADLESS_MAX_DURATION_SECONDS)}.`;
  }
  return {
    ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
    ...(maxSeconds === undefined ? {} : { maxDurationMs: maxSeconds * 1_000 }),
    ...(file === undefined ? {} : { mcpTokenFile: path.resolve(cwd, file) }),
  };
}

/** `--mcp-login <server>`: a sign-in, which needs the config that names the server and no prompt. */
export function loginFrom(values: Values, cwd: string): HeadlessParse {
  const server = lastOf(values, 'mcpLogin') ?? '';
  const config = lastOf(values, 'mcpConfig');
  if (config === undefined)
    return { kind: 'usage', message: '--mcp-login needs --mcp-config <file>.' };
  const file = lastOf(values, 'mcpTokenFile');
  return {
    kind: 'login',
    login: {
      server,
      mcpConfig: path.resolve(cwd, config),
      ...(file === undefined ? {} : { tokenFile: path.resolve(cwd, file) }),
    },
  };
}
