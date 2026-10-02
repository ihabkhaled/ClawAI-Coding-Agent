import { firstOutside, rebaseGlobs, underFolder } from './agent-team-glob';
import { browserHostsProblem, httpHostsProblem } from './agent-team-hosts';
import {
  TEAM_CHILD_DEFAULT_DURATION_MS,
  TEAM_CHILD_DEFAULT_TOOL_CALLS,
  TEAM_CHILD_MIN_DURATION_MS,
  TEAM_CHILD_MIN_TOOL_CALLS,
  TEAM_PARENT_RESERVE_MS,
} from './agent-team-tool.constants';

import type { SpawnRequest } from './agent-team-tool.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

/** What the parent holds, which a child can only narrow. */
export interface ParentGrant {
  readonly allow: readonly AgentToolCategory[];
  /** The parent's own write scope, workspace-relative; undefined is "anywhere". */
  readonly writeScope: readonly string[] | undefined;
  readonly writeDeny: readonly string[] | undefined;
  /** Hosts the parent's http tool may reach. */
  readonly httpAllowHosts?: readonly string[] | undefined;
  /** Private hosts the parent's browser may open. */
  readonly browserAllowHosts?: readonly string[] | undefined;
  /** Whether the parent has the second shell switch on. */
  readonly shell?: boolean | undefined;
}

/** What a child is given, always inside what its parent holds. */
export interface ChildGrant {
  readonly granted: readonly AgentToolCategory[];
  /** Left out because the parent does not hold them. */
  readonly notGranted: readonly AgentToolCategory[];
  /** The child's write scope as the child reads it (its root is the folder, if any). */
  readonly writeScope: readonly string[] | undefined;
  readonly writeDeny: readonly string[] | undefined;
  /** The same scope as the parent reads it, for overlap checks. */
  readonly parentGlobs: readonly string[];
  /** Whether the child can change anything: write, git-write or a command. */
  readonly writes: boolean;
  /** The hosts the child's http tool may reach, and the private hosts its browser may open. */
  readonly httpAllowHosts: readonly string[];
  readonly browserAllowHosts: readonly string[];
  /** Whether the child is given the shell. */
  readonly shell: boolean;
}

const WRITING: readonly AgentToolCategory[] = ['write', 'git-write', 'command', 'shell'];

/** What a child is never given unless the spawn names it: the network and the shell are opt-in per child. */
const OPT_IN: readonly AgentToolCategory[] = ['agents', 'shell', 'http', 'http-write', 'browser'];

/** The categories the spawn asks for: its list, or the parent's quiet ones, plus the shell when switched on. */
function wantedCategories(
  parent: ParentGrant,
  request: SpawnRequest,
): readonly AgentToolCategory[] {
  const base = request.tools ?? parent.allow.filter((category) => !OPT_IN.includes(category));
  return request.shell === true && !base.includes('shell') ? [...base, 'shell'] : base;
}

/** The reason a network or shell request exceeds what the parent holds, or undefined. */
function networkProblem(parent: ParentGrant, request: SpawnRequest): string | undefined {
  if (request.shell === true && (!parent.allow.includes('shell') || parent.shell !== true)) {
    return 'You do not hold the shell (it needs shell in the grants and the second shell switch), so a child cannot be given it.';
  }
  return (
    httpHostsProblem(request.httpAllowHosts ?? [], parent.httpAllowHosts) ??
    browserHostsProblem(request.browserAllowHosts ?? [], parent.browserAllowHosts)
  );
}

/**
 * The grant a child gets, or the sentence saying why it cannot have what was
 * asked. Categories are the ones asked for that the parent also holds. A write
 * scope must lie inside the parent's; asked for none, the child keeps the
 * parent's own, or the folder it was given. Whatever the parent denies the
 * child is denied. Http hosts and browser hosts must lie inside the parent's
 * lists, and a child has http only when it is given at least one host.
 */
export function narrowGrant(parent: ParentGrant, request: SpawnRequest): ChildGrant | string {
  const refused = networkProblem(parent, request);
  if (refused !== undefined) return refused;
  const wanted = wantedCategories(parent, request);
  const hosts = request.httpAllowHosts ?? [];
  const holds = (category: AgentToolCategory): boolean =>
    parent.allow.includes(category) &&
    (!['http', 'http-write'].includes(category) || hosts.length > 0);
  const granted = wanted.filter(holds);
  const notGranted = wanted.filter((category) => !holds(category));
  if (granted.length === 0) {
    return `You do not hold ${wanted.join(', ')}, so a child cannot be given it. You hold: ${parent.allow.join(', ')}.`;
  }
  const folder = request.workspaceSubdir ?? '';
  const writes = granted.some((category) => WRITING.includes(category));
  const scope = scopeFor(parent, request, folder);
  if (typeof scope === 'string') return scope;
  return {
    granted,
    notGranted,
    writeScope: scope.child,
    writeDeny: parent.writeDeny === undefined ? undefined : rebaseGlobs(parent.writeDeny, folder),
    parentGlobs: writes ? scope.parent : [],
    writes,
    httpAllowHosts: granted.some((category) => category.startsWith('http')) ? hosts : [],
    browserAllowHosts: granted.includes('browser') ? (request.browserAllowHosts ?? []) : [],
    shell: granted.includes('shell'),
  };
}

function scopeFor(
  parent: ParentGrant,
  request: SpawnRequest,
  folder: string,
): { child: readonly string[] | undefined; parent: readonly string[] } | string {
  const own = parent.writeScope ?? [];
  if (request.writeScope !== undefined) {
    const asParent = request.writeScope.map((glob) => underFolder(folder, glob));
    const outside = own.length === 0 ? undefined : firstOutside(asParent, own);
    return outside === undefined
      ? { child: request.writeScope, parent: asParent }
      : `writeScope "${outside}" is not inside your own write scope (${own.join(', ')}).`;
  }
  if (folder.length > 0) {
    const asParent = [`${folder}/**`];
    return own.length > 0 && firstOutside(asParent, own) !== undefined
      ? `workspaceSubdir "${folder}" is not inside your own write scope (${own.join(', ')}).`
      : { child: undefined, parent: asParent };
  }
  return { child: own.length === 0 ? undefined : own, parent: own.length === 0 ? ['**'] : own };
}

/** What a parent can spare, read at the moment of a spawn. */
export interface BudgetRoom {
  /** Tool calls not yet used or set aside; undefined when the parent has no limit. */
  readonly toolCalls: number | undefined;
  /** Milliseconds until the parent's deadline; undefined when it has none. */
  readonly durationMs: number | undefined;
}

/** What a child gets when none is named: the usual, but never more than half of what is left, so its siblings fit. */
function defaultCalls(room: BudgetRoom): number {
  if (room.toolCalls === undefined) return TEAM_CHILD_DEFAULT_TOOL_CALLS;
  return Math.min(
    TEAM_CHILD_DEFAULT_TOOL_CALLS,
    Math.max(TEAM_CHILD_MIN_TOOL_CALLS, Math.floor(room.toolCalls / 2)),
  );
}

/** A child's budget, carved from what is left, or why there is none to give. */
export function carveBudget(
  room: BudgetRoom,
  request: Pick<SpawnRequest, 'maxToolCalls' | 'maxDurationSec'>,
): { readonly toolCalls: number; readonly durationMs: number | undefined } | string {
  const asked = request.maxToolCalls ?? defaultCalls(room);
  const toolCalls = room.toolCalls === undefined ? asked : Math.min(asked, room.toolCalls);
  if (toolCalls < TEAM_CHILD_MIN_TOOL_CALLS) {
    return `Your tool-call budget has only ${String(Math.max(room.toolCalls ?? 0, 0))} call(s) to spare; a child needs at least ${String(TEAM_CHILD_MIN_TOOL_CALLS)}. Do the rest yourself.`;
  }
  const spare =
    room.durationMs === undefined ? undefined : room.durationMs - TEAM_PARENT_RESERVE_MS;
  if (spare !== undefined && spare < TEAM_CHILD_MIN_DURATION_MS) {
    return 'Your time budget is almost used; a child would not have time to finish. Do the rest yourself.';
  }
  const wanted =
    request.maxDurationSec === undefined
      ? TEAM_CHILD_DEFAULT_DURATION_MS
      : request.maxDurationSec * 1_000;
  return { toolCalls, durationMs: spare === undefined ? wanted : Math.min(wanted, spare) };
}
