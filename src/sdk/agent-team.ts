import { randomUUID } from 'node:crypto';
import { env } from 'node:process';

import { headlessStateDirectory } from '../headless/headless-session-store';

import { agentName, nameProblem, parseNames, parseTimeout } from './agent-team-args';
import { createTeamBus } from './agent-team-bus';
import { cancelQueued } from './agent-team-child';
import { childView, isOver } from './agent-team-report';
import { budgetRoom, spawnChild } from './agent-team-spawn';
import {
  AGENT_TEAM_TOOL_DESCRIPTION,
  AGENT_TEAM_TOOL_INPUT_SCHEMA,
  AGENT_TEAM_TOOL_NAME,
  TEAM_ALL_OPERATIONS,
  TEAM_DEFAULT_CONCURRENCY,
  TEAM_INBOX_MAX_CHARS,
  TEAM_LEAD_NAME,
  TEAM_MAX_DEPTH,
  TEAM_MEMBER_OPERATIONS,
} from './agent-team-tool.constants';
import { isApproved } from './permission-modes';

import type { AgentToolCall, AgentToolkit } from './agent-sdk.types';
import type {
  AgentFactory,
  AgentTeam,
  TeamApprover,
  TeamChild,
  TeamContext,
  TeamHub,
  TeamMessage,
  TeamOperation,
} from './agent-team-tool.types';
import type { AgentConfig } from './create-agent.types';
import type { AgentToolCategory } from './workspace-toolkit.types';

type Args = Readonly<Record<string, unknown>>;

/** How long `close` waits for children to wind down after they are told to stop. */
const CLOSE_WAIT_MS = 10_000;

function newHub(config: AgentConfig): TeamHub {
  const bus = createTeamBus();
  bus.register(TEAM_LEAD_NAME);
  return {
    lead: TEAM_LEAD_NAME,
    maxConcurrent: config.maxAgents ?? TEAM_DEFAULT_CONCURRENCY,
    runKey: randomUUID().slice(0, 8),
    stateDirectory: headlessStateDirectory(env),
    bus,
    children: new Map(),
    spawned: 0,
    active: 0,
    queue: [],
  };
}

function ownChild(context: TeamContext, raw: unknown, field: string): TeamChild {
  const problem = nameProblem(raw, field);
  if (problem !== undefined) throw new Error(problem);
  const name = agentName(raw);
  const child = context.mine.get(name);
  if (child === undefined) {
    const known = [...context.mine.keys()].join(', ');
    throw new Error(
      `You have no child named "${name}". Yours: ${known.length === 0 ? 'none' : known}.`,
    );
  }
  return child;
}

function postMessage(context: TeamContext, args: Args): Record<string, unknown> {
  const problem = nameProblem(args.to, 'message "to"');
  if (problem !== undefined) throw new Error(problem);
  const text = typeof args.text === 'string' ? args.text : '';
  const message = context.hub.bus.post(context.self, agentName(args.to), text);
  context.binding?.emit({
    type: 'agent.message',
    from: message.from,
    to: message.to,
    chars: message.text.length,
  });
  return { sent: true, to: message.to };
}

function readInbox(context: TeamContext): Record<string, unknown> {
  const messages = context.hub.bus.drain(context.self, TEAM_INBOX_MAX_CHARS);
  return {
    messages: messages.map((message) => ({ from: message.from, text: message.text })),
    unread: context.hub.bus.pending(context.self),
  };
}

function statusOf(context: TeamContext): Record<string, unknown> {
  const room = budgetRoom(context);
  return {
    children: [...context.mine.values()].map((child) => childView(child, false)),
    unread: context.hub.bus.pending(context.self),
    startedInRun: context.hub.spawned,
    working: context.hub.active,
    ...(room.toolCalls === undefined ? {} : { toolCallsLeft: Math.max(room.toolCalls, 0) }),
  };
}

function cancelOne(context: TeamContext, child: TeamChild): void {
  if (isOver(child)) return;
  const launch = context.launches.get(child.name);
  if (child.state === 'queued' && launch !== undefined) cancelQueued(launch);
  else child.abort.abort();
}

async function cancelChild(context: TeamContext, args: Args): Promise<Record<string, unknown>> {
  const child = ownChild(context, args.name, 'cancel');
  cancelOne(context, child);
  await Promise.race([child.done, delay(5_000)]);
  return childView(child, false);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function waitPlan(
  context: TeamContext,
  args: Args,
): { readonly targets: readonly TeamChild[]; readonly timeoutMs: number } {
  const names = parseNames(args.names);
  const timeoutMs = parseTimeout(args.timeoutMs);
  if (typeof names === 'string') throw new Error(names);
  if (typeof timeoutMs === 'string') throw new Error(timeoutMs);
  const targets =
    names === undefined
      ? [...context.mine.values()]
      : names.map((name) => ownChild(context, name, 'wait'));
  return { targets, timeoutMs };
}

function waitView(
  targets: readonly TeamChild[],
  messages: readonly TeamMessage[],
): Record<string, unknown> {
  const pending = targets.filter((child) => !isOver(child));
  return {
    done: pending.length === 0,
    ...(pending.length > 0 && messages.length === 0 ? { timedOut: true } : {}),
    children: targets.map((child) => childView(child, false)),
    ...(messages.length === 0
      ? {}
      : { messages: messages.map((message) => ({ from: message.from, text: message.text })) }),
    ...(pending.length === 0 ? {} : { stillRunning: pending.map((child) => child.name) }),
  };
}

/**
 * Waits for the named children (default: all of this agent's), a message to this
 * agent, the timeout, or the run being cancelled, whichever is first. Only an
 * agent's own children can be waited for, so no wait can depend on itself, and
 * every child ends (the team's watchdog) so a wait always has an end.
 */
async function waitFor(
  context: TeamContext,
  args: Args,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  const { targets, timeoutMs } = waitPlan(context, args);
  const deadline = Date.now() + timeoutMs;
  const inbox = context.hub.bus;
  let messages = inbox.drain(context.self, TEAM_INBOX_MAX_CHARS);
  while (
    messages.length === 0 &&
    targets.some((child) => !isOver(child)) &&
    Date.now() < deadline &&
    signal?.aborted !== true
  ) {
    await wake(context, targets, deadline - Date.now(), signal);
    messages = inbox.drain(context.self, TEAM_INBOX_MAX_CHARS);
  }
  return waitView(targets, messages);
}

/** Resolves when any target finishes, a message arrives, the time is up, or the signal aborts. */
function wake(
  context: TeamContext,
  targets: readonly TeamChild[],
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    const cleanups: (() => void)[] = [];
    const end = (): void => {
      for (const cleanup of cleanups) cleanup();
      resolve();
    };
    const timer = setTimeout(end, Math.max(ms, 1));
    cleanups.push(() => {
      clearTimeout(timer);
    });
    cleanups.push(
      context.hub.bus.onPost((to) => {
        if (to === context.self) end();
      }),
    );
    if (signal !== undefined) {
      signal.addEventListener('abort', end, { once: true });
      cleanups.push(() => {
        signal.removeEventListener('abort', end);
      });
    }
    for (const child of targets) if (!isOver(child)) void child.done.then(end);
  });
}

async function run(
  context: TeamContext,
  call: AgentToolCall,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const args = call.arguments;
  switch (call.operation as TeamOperation) {
    case 'spawn':
      return spawnChild(context, args);
    case 'message':
      return postMessage(context, args);
    case 'inbox':
      return readInbox(context);
    case 'wait':
      return waitFor(context, args, signal);
    case 'status':
      return statusOf(context);
    case 'result':
      return childView(ownChild(context, args.name, 'result'), true);
    case 'cancel':
      return cancelChild(context, args);
    default:
      throw new Error(`agent.team has no operation "${call.operation}".`);
  }
}

/** The operations this agent is offered: all with `agents` (spawning needs depth to spare), else only talking. */
function offered(context: TeamContext): readonly TeamOperation[] {
  const spawns = context.grants.includes('agents') && context.depth < TEAM_MAX_DEPTH;
  return spawns ? TEAM_ALL_OPERATIONS : TEAM_MEMBER_OPERATIONS;
}

function toolkitFor(
  context: TeamContext,
  approve: TeamApprover | undefined,
): AgentToolkit | undefined {
  const operations = offered(context);
  if (context.config.teamLink === undefined && !context.grants.includes('agents')) return undefined;
  return {
    definitions: [
      {
        schemaVersion: '2.0',
        name: AGENT_TEAM_TOOL_NAME,
        version: '1.0.0',
        description: AGENT_TEAM_TOOL_DESCRIPTION,
        operations,
        riskClasses: ['process'],
        targetIds: ['target:workspace'],
        inputSchema: AGENT_TEAM_TOOL_INPUT_SCHEMA,
      },
    ],
    authorize: async (call) => {
      if (call.toolName !== AGENT_TEAM_TOOL_NAME) return false;
      if (!operations.some((operation) => operation === call.operation)) return false;
      if (call.operation !== 'spawn' || approve === undefined) return true;
      return isApproved(await approve({ ...call, category: 'agents' }));
    },
    execute: (call, signal) => run(context, call, signal),
  };
}

/**
 * One agent's team: the tool it is offered and the children it started.
 *
 * The lead founds a hub that everyone in the run shares (bus, counters, slots);
 * a child, built with a `teamLink`, joins it. Undefined when the agent has no
 * reason to have a team: no `agents` grant and no parent.
 */
export function createTeam(config: AgentConfig, factory: AgentFactory): AgentTeam | undefined {
  const link = config.teamLink;
  const asked = config.permissions?.allow.includes('agents') === true;
  if (link === undefined && !asked) return undefined;
  const context: TeamContext = {
    config,
    factory,
    hub: link?.hub ?? newHub(config),
    self: link?.name ?? TEAM_LEAD_NAME,
    depth: link?.depth ?? 0,
    mine: new Map(),
    launches: new Map(),
    grants: config.permissions?.allow ?? [],
    binding: undefined,
  };
  let detach: (() => void) | undefined;
  const cancelAll = (): void => {
    for (const child of context.mine.values()) cancelOne(context, child);
  };
  return {
    toolkit: (grants: readonly AgentToolCategory[], approve) => {
      context.grants = grants;
      return toolkitFor(context, approve);
    },
    attach: (binding) => {
      detach?.();
      context.binding = binding;
      const { signal } = binding;
      if (signal === undefined) return;
      if (signal.aborted) cancelAll();
      signal.addEventListener('abort', cancelAll, { once: true });
      detach = () => {
        signal.removeEventListener('abort', cancelAll);
      };
    },
    close: async () => {
      detach?.();
      cancelAll();
      await Promise.race([
        Promise.all([...context.mine.values()].map((child) => child.done)),
        delay(CLOSE_WAIT_MS),
      ]);
    },
  };
}
