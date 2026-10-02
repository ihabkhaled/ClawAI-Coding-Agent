import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { containedPath } from '../core/workspace-containment';

import { parseSpawn } from './agent-team-args';
import { childConfig, childPrompt, launchChild } from './agent-team-child';
import { globInsideAny, scopesOverlap } from './agent-team-glob';
import { carveBudget, narrowGrant } from './agent-team-narrow';
import { isOver } from './agent-team-report';
import { TEAM_MAX_TOTAL } from './agent-team-tool.constants';
import { createWorktree, removeWorktree } from './agent-team-worktree';
import { createWriteScope, pathInScope } from './write-scope';

import type { ChildGrant, BudgetRoom } from './agent-team-narrow';
import type {
  ChildLaunch,
  SpawnRequest,
  TeamChild,
  TeamContext,
  TeamWorktree,
} from './agent-team-tool.types';
import type { AgentEvent } from './create-agent.types';

type Args = Readonly<Record<string, unknown>>;

/** The names of this agent and every agent above it. */
function lineage(context: TeamContext): ReadonlySet<string> {
  const names = new Set<string>([context.self]);
  let current = context.hub.children.get(context.self);
  while (current !== undefined) {
    names.add(current.parent);
    current = context.hub.children.get(current.parent);
  }
  return names;
}

/** The sentence refusing a spawn whose files another working child already owns. */
function overlapProblem(
  context: TeamContext,
  request: SpawnRequest,
  grant: ChildGrant,
): string | undefined {
  if (!grant.writes || request.isolation === 'worktree') return undefined;
  const above = lineage(context);
  for (const other of context.hub.children.values()) {
    if (isOver(other) || above.has(other.name) || other.writeGlobs.length === 0) continue;
    if (scopesOverlap(grant.parentGlobs, other.writeGlobs)) {
      return `"${other.name}" is already changing ${other.writeGlobs.join(', ')}, which overlaps this child's files (${grant.parentGlobs.join(', ')}). Give each child a disjoint writeScope or workspaceSubdir, or use isolation "worktree".`;
    }
  }
  return undefined;
}

/** What this agent can still hand out: its own allowance less what it used and what its children hold. */
export function budgetRoom(context: TeamContext): BudgetRoom {
  const binding = context.binding;
  if (binding === undefined) return { toolCalls: undefined, durationMs: undefined };
  let held = 0;
  for (const child of context.mine.values())
    held += isOver(child) ? child.toolCalls : child.reserved;
  return {
    toolCalls:
      binding.maxToolCalls === undefined
        ? undefined
        : binding.maxToolCalls - binding.callsSoFar() - held,
    durationMs: binding.deadlineAt === undefined ? undefined : binding.deadlineAt - Date.now(),
  };
}

/** The folder a child is rooted at, made if it is missing and the scope allows it. */
function rootFor(
  base: string,
  folder: string | undefined,
  parentScope: readonly string[] | undefined,
): string {
  if (folder === undefined) return base;
  const root = containedPath(base, folder);
  const inside = parentScope === undefined || globInsideAny(`${folder}/**`, parentScope);
  try {
    mkdirSync(root, { recursive: true });
  } catch {
    throw new Error(`workspaceSubdir "${folder}" cannot be created.`);
  }
  if (!inside) throw new Error(`workspaceSubdir "${folder}" is outside your write scope.`);
  return containedPath(base, folder);
}

function refuseName(context: TeamContext, name: string): never {
  const total = TEAM_MAX_TOTAL;
  throw new Error(
    context.hub.children.has(name)
      ? `An agent named "${name}" already exists in this run; pick another name.`
      : `A run starts at most ${String(total)} children and ${String(total)} have been started.`,
  );
}

function makeChild(input: {
  readonly request: SpawnRequest;
  readonly grant: ChildGrant;
  readonly context: TeamContext;
  readonly calls: number;
  readonly durationMs: number;
  readonly worktree: TeamWorktree | undefined;
}): { child: TeamChild; settle: () => void } {
  const { request, grant, context } = input;
  let settle: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const scope = createWriteScope({
    scope: grant.parentGlobs,
    deny: context.config.permissions?.writeDeny,
  });
  const child: TeamChild = {
    name: request.name,
    parent: context.self,
    depth: context.depth + 1,
    task: request.task.slice(0, 200),
    abort: new AbortController(),
    touched: new Set<string>(),
    granted: grant.granted,
    writeGlobs: input.worktree === undefined ? grant.parentGlobs : [],
    isolated: input.worktree !== undefined,
    mayChange: (relative) => scope === undefined || pathInScope(scope, relative),
    reserved: input.calls,
    maxDurationMs: input.durationMs,
    state: 'queued',
    outcome: undefined,
    error: undefined,
    report: '',
    toolCalls: 0,
    startedAt: undefined,
    finishedAt: undefined,
    threadId: undefined,
    worktree: input.worktree,
    merge: undefined,
    done,
  };
  return { child, settle };
}

interface Plan {
  readonly request: SpawnRequest;
  readonly grant: ChildGrant;
  readonly toolCalls: number;
  readonly durationMs: number;
}

/**
 * Every refusal, before anything exists: the arguments are checked, then the
 * name and the run's total, then the grant (which can only narrow), the file
 * overlap with children still working, and the budget carved from what is left.
 */
function plan(context: TeamContext, args: Args): Plan {
  const parsed = parseSpawn(args);
  if ('problem' in parsed) throw new Error(parsed.problem);
  const { request } = parsed;
  const { hub, config } = context;
  if (context.binding === undefined) throw new Error('The team is not attached to a run.');
  if (hub.spawned >= TEAM_MAX_TOTAL || hub.children.has(request.name)) {
    refuseName(context, request.name);
  }
  const grant = narrowGrant(
    {
      allow: context.grants,
      writeScope: config.permissions?.writeScope,
      writeDeny: config.permissions?.writeDeny,
    },
    request,
  );
  if (typeof grant === 'string') throw new Error(grant);
  const clash = overlapProblem(context, request, grant);
  if (clash !== undefined) throw new Error(clash);
  const budget = carveBudget(budgetRoom(context), request);
  if (typeof budget === 'string') throw new Error(budget);
  return { request, grant, toolCalls: budget.toolCalls, durationMs: budget.durationMs ?? 0 };
}

/** The checkout (when isolated) and the folder the child is rooted at; a failure removes what was made. */
function place(
  context: TeamContext,
  request: SpawnRequest,
): { readonly worktree: TeamWorktree | undefined; readonly root: string } {
  const { config, hub } = context;
  const workspace = path.resolve(config.workspaceRoot);
  const worktree =
    request.isolation === 'worktree'
      ? createWorktree(workspace, {
          stateDirectory: hub.stateDirectory,
          runKey: hub.runKey,
          name: request.name,
        })
      : undefined;
  if (typeof worktree === 'string') throw new Error(worktree);
  try {
    const root = rootFor(
      worktree?.workspace ?? workspace,
      request.workspaceSubdir,
      config.permissions?.writeScope,
    );
    return { worktree, root };
  } catch (error) {
    if (worktree !== undefined) removeWorktree(worktree);
    throw error;
  }
}

function spawnedEvent(child: TeamChild, made: Plan): AgentEvent {
  const { request, grant } = made;
  return {
    type: 'agent.spawned',
    name: child.name,
    parent: child.parent,
    depth: child.depth,
    task: child.task,
    tools: grant.granted,
    ...(grant.writeScope === undefined ? {} : { writeScope: grant.writeScope }),
    isolation: request.isolation,
    maxToolCalls: made.toolCalls,
    maxDurationSec: Math.round(made.durationMs / 1_000),
    ...(request.model === undefined ? {} : { model: request.model }),
  };
}

/** Starts a child, or throws the reason it cannot be started. */
export function spawnChild(context: TeamContext, args: Args): Record<string, unknown> {
  const made = plan(context, args);
  const { request, grant } = made;
  const { hub, config, binding } = context;
  const placed = place(context, request);
  const { child, settle } = makeChild({
    request,
    grant,
    context,
    calls: made.toolCalls,
    durationMs: made.durationMs,
    worktree: placed.worktree,
  });
  hub.spawned += 1;
  hub.children.set(child.name, child);
  context.mine.set(child.name, child);
  hub.bus.register(child.name);
  const emit = (event: AgentEvent): void => {
    context.binding?.emit(event);
  };
  emit(spawnedEvent(child, made));
  const launch: ChildLaunch = {
    hub,
    child,
    factory: context.factory,
    config: childConfig({
      parent: config,
      link: { hub, name: child.name, depth: child.depth },
      grant,
      request,
      root: placed.root,
      token: binding?.token(),
    }),
    prompt: childPrompt({
      name: child.name,
      parent: context.self,
      request,
      grant,
      isolated: placed.worktree !== undefined,
    }),
    maxToolCalls: made.toolCalls,
    emit,
    parentName: context.self,
    settle,
  };
  context.launches.set(child.name, launch);
  launchChild(launch);
  return {
    name: child.name,
    state: child.state,
    granted: grant.granted,
    ...(grant.notGranted.length === 0 ? {} : { notGranted: grant.notGranted }),
    writeScope: grant.writeScope ?? 'anywhere in its workspace',
    budget: {
      maxToolCalls: made.toolCalls,
      maxDurationSec: Math.round(made.durationMs / 1_000),
    },
    ...(placed.worktree === undefined ? {} : { worktree: placed.worktree.directory }),
    note: 'Started. Spawn the other independent children, then call wait.',
  };
}
