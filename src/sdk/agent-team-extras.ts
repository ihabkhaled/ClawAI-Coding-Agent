import { doneChecksProblem } from './done-checks';

import type { SpawnRequest } from './agent-team-tool.types';
import type { DoneCheck } from './done-checks.types';

type Args = Readonly<Record<string, unknown>>;

/** The most host entries a child may be given per list. */
const MAX_HOSTS = 16;

type Extras = Pick<SpawnRequest, 'httpAllowHosts' | 'browserAllowHosts' | 'shell' | 'doneChecks'>;

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hostList(raw: unknown, field: string): readonly string[] | undefined | string {
  if (raw === undefined) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.length > MAX_HOSTS ||
    raw.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)
  ) {
    return `"${field}" is a list of at most ${String(MAX_HOSTS)} host names.`;
  }
  return raw.map((entry) => String(entry).trim());
}

function checkOf(entry: unknown): DoneCheck | undefined {
  if (!isRecord(entry)) return undefined;
  const { label, executable, args, cwd, timeoutMs } = entry;
  if (typeof label !== 'string' || typeof executable !== 'string') return undefined;
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) return undefined;
  return {
    label,
    executable,
    args: args.map((arg) => String(arg)),
    ...(typeof cwd === 'string' ? { cwd } : {}),
    ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
  };
}

function checkList(raw: unknown): readonly DoneCheck[] | undefined | string {
  if (raw === undefined) return undefined;
  const bad = '"doneChecks" is a list of {label, executable, args[]}.';
  if (!Array.isArray(raw)) return bad;
  const checks: DoneCheck[] = [];
  for (const entry of raw) {
    const check = checkOf(entry);
    if (check === undefined) return bad;
    checks.push(check);
  }
  return doneChecksProblem(checks) ?? checks;
}

/**
 * The options a spawn may carry beyond the model-facing ones: per-child http and
 * browser hosts, the shell switch and completion checks. They are for the code
 * that starts a child (the orchestrator); each is still narrowed by the parent.
 */
export function parseExtras(args: Args): Extras | string {
  const http = hostList(args.httpAllowHosts, 'httpAllowHosts');
  const browser = hostList(args.browserAllowHosts, 'browserAllowHosts');
  const checks = checkList(args.doneChecks);
  if (args.shell !== undefined && typeof args.shell !== 'boolean')
    return '"shell" is true or false.';
  for (const found of [http, browser, checks]) if (typeof found === 'string') return found;
  return {
    httpAllowHosts: typeof http === 'string' ? undefined : http,
    browserAllowHosts: typeof browser === 'string' ? undefined : browser,
    shell: args.shell === true ? true : undefined,
    doneChecks: typeof checks === 'string' ? undefined : checks,
  };
}
