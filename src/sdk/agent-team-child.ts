import path from 'node:path';

import { redactText } from '../core/redaction';

import { TEAM_CHILD_AUTO_CONTINUE, TEAM_TOUCHED_MAX } from './agent-team-tool.constants';
import { mergeChanges, collectChanges, removeWorktree } from './agent-team-worktree';
import { AGENT_TOOL_OPERATIONS } from './workspace-toolkit.constants';

import type { ChildGrant } from './agent-team-narrow';
import type {
  ChildLaunch,
  SpawnRequest,
  TeamChild,
  TeamFinalState,
  TeamHub,
  TeamLink,
} from './agent-team-tool.types';
import type { AgentConfig, AgentEvent, AgentResult } from './create-agent.types';

/** Time past a child's own limit before the team stops waiting for it to stop. */
const WATCHDOG_GRACE_MS = 20_000;

/** The longest error text kept for a child. */
const ERROR_CHARS = 400;

/** The configuration of a child: the parent's, narrowed. It can only have less, never more. */
export function childConfig(input: {
  readonly parent: AgentConfig;
  readonly link: TeamLink;
  readonly grant: ChildGrant;
  readonly request: SpawnRequest;
  readonly root: string;
  readonly token: string | undefined;
}): AgentConfig {
  const { parent, grant, request } = input;
  const auth =
    input.token !== undefined && input.token.length > 0 ? { token: input.token } : parent.auth;
  return {
    auth,
    workspaceRoot: input.root,
    backendUrl: parent.backendUrl,
    model: request.model ?? parent.model,
    provider: parent.provider,
    permissions: {
      allow: grant.granted,
      allowedExecutables: parent.permissions?.allowedExecutables,
      ...(grant.httpAllowHosts.length > 0 ? { httpAllowHosts: grant.httpAllowHosts } : {}),
      // The second shell switch is the parent's own; the child inherits its denials and its approver.
      ...(grant.shell ? { shell: parent.permissions?.shell } : {}),
      writeScope: grant.writeScope,
      writeDeny: grant.writeDeny,
      // The parent's own approver: a child never asks anyone else, and with none it is denied.
      approve: parent.permissions?.approve,
    },
    permissionMode: parent.permissionMode,
    allowedTools: parent.allowedTools,
    disallowedTools: parent.disallowedTools,
    systemPrompt: parent.systemPrompt,
    useMemory: parent.useMemory,
    retry: parent.retry,
    transport: parent.transport,
    mcp: grant.granted.includes('mcp') ? parent.mcp : undefined,
    browser: grant.granted.includes('browser')
      ? { ...parent.browser, allowHosts: grant.browserAllowHosts }
      : undefined,
    doneChecks: request.doneChecks,
    research: parent.research,
    webResearch: parent.webResearch,
    teamLink: input.link,
  };
}

/** What the child is told: who it is, what it may touch, how to finish. Then the task. */
export function childPrompt(input: {
  readonly name: string;
  readonly parent: string;
  readonly request: SpawnRequest;
  readonly grant: ChildGrant;
  readonly isolated: boolean;
}): string {
  const { request, grant } = input;
  const scope =
    grant.writeScope === undefined
      ? 'You may change files anywhere in your workspace.'
      : `You may change only: ${grant.writeScope.join(', ')}.`;
  const lines = [
    `You are the sub-agent "${input.name}", started by "${input.parent}". Other agents work in parallel on other parts of the same project and cannot see this conversation.`,
    grant.writes ? scope : 'You may read, not change.',
    request.workspaceSubdir === undefined
      ? undefined
      : `Your workspace root is the folder ${request.workspaceSubdir}: every path is relative to it.`,
    input.isolated
      ? 'You work in an isolated checkout; your changes are merged back when you finish.'
      : undefined,
    'Stay inside your task. If something outside it must change, say so in your report instead of changing it. If you need an answer from another agent, send agent.team message; read agent.team inbox before you finish.',
    'Finish with a short final report (under 250 words): what you did, the files, how you verified it (commands and results), what is missing or failing. Do not paste file contents.',
    '',
    'Task:',
    request.task,
  ];
  return lines.filter((line) => line !== undefined).join('\n');
}

function writtenPath(event: AgentEvent): string | undefined {
  if (event.type !== 'tool.call' || event.toolName !== 'workspace.file') return undefined;
  if (AGENT_TOOL_OPERATIONS['workspace.file']?.[event.operation] !== 'write') return undefined;
  const { path: target } = event.arguments;
  return typeof target === 'string'
    ? target.replaceAll('\\', '/').replace(/^\.\//u, '')
    : undefined;
}

/** What a child's own event tells the team: a call made, a file written, an agent event to pass up. */
function watch(launch: ChildLaunch, event: AgentEvent): void {
  const { child } = launch;
  if (event.type === 'tool.call') child.toolCalls += 1;
  if (event.type === 'run.started') child.threadId = event.threadId;
  const written = writtenPath(event);
  if (written !== undefined && child.touched.size < TEAM_TOUCHED_MAX) child.touched.add(written);
  if (event.type.startsWith('agent.')) launch.emit(event);
}

/** Hands a slot to the next child in line, or frees it. */
function release(hub: TeamHub): void {
  const next = hub.queue.shift();
  if (next === undefined) hub.active -= 1;
  else next();
}

function stateOf(result: AgentResult | undefined): {
  state: TeamFinalState;
  outcome: TeamChild['outcome'];
} {
  if (result === undefined) return { state: 'failed', outcome: undefined };
  if (result.outcome === 'completed') return { state: 'completed', outcome: result.outcome };
  if (result.outcome === 'cancelled') return { state: 'cancelled', outcome: result.outcome };
  return { state: 'failed', outcome: result.outcome };
}

/** Takes a worktree child's changes back (when it completed) and removes the checkout. */
function reclaim(launch: ChildLaunch): void {
  const { child, hub } = launch;
  const worktree = child.worktree;
  if (worktree === undefined) return;
  try {
    const changes = collectChanges(worktree);
    const patchFile = path.join(hub.stateDirectory, 'team', hub.runKey, `${child.name}.patch`);
    child.merge =
      changes.problem !== undefined
        ? { merged: false, files: changes.files, problem: changes.problem }
        : child.state === 'completed'
          ? mergeChanges(worktree, changes, patchFile, child.mayChange)
          : {
              merged: false,
              files: changes.files,
              problem: 'The child did not complete, so its changes were not merged.',
            };
  } catch (error) {
    child.merge = {
      merged: false,
      files: [],
      problem: redactText(error instanceof Error ? error.message : 'merge failed').slice(0, 300),
    };
  } finally {
    removeWorktree(worktree);
  }
}

function finishedEvent(
  launch: ChildLaunch,
  state: TeamFinalState,
  outcome: TeamChild['outcome'],
): AgentEvent {
  const { child } = launch;
  const started = child.startedAt;
  return {
    type: 'agent.finished',
    name: child.name,
    parent: launch.parentName,
    state,
    ...(outcome === undefined ? {} : { outcome }),
    toolCalls: child.toolCalls,
    durationMs: started === undefined ? 0 : (child.finishedAt ?? started) - started,
    files: child.touched.size,
    ...(child.threadId === undefined ? {} : { threadId: child.threadId }),
    ...(child.error === undefined ? {} : { error: child.error }),
  };
}

/** Ends a child once, whichever way: records it, merges, frees the slot, tells the team. */
function finish(
  launch: ChildLaunch,
  result: AgentResult | undefined,
  crash: string | undefined,
): void {
  const { child, hub } = launch;
  if (child.finishedAt !== undefined) return;
  child.finishedAt = Date.now();
  const mapped = stateOf(result);
  child.state = mapped.state;
  child.outcome = mapped.outcome;
  if (result !== undefined) child.toolCalls = result.toolCalls;
  child.report = redactText((result?.text ?? '').trim());
  const reason = crash ?? result?.error;
  child.error = reason === undefined ? undefined : redactText(reason).slice(0, ERROR_CHARS);
  reclaim(launch);
  hub.bus.close(child.name);
  if (child.startedAt !== undefined) release(hub);
  launch.emit(finishedEvent(launch, mapped.state, mapped.outcome));
  launch.settle();
}

/** Ends a child that never got to run. */
export function cancelQueued(launch: ChildLaunch): void {
  if (launch.child.state !== 'queued') return;
  finish(
    launch,
    { outcome: 'cancelled', exitCode: 130, toolCalls: 0, deniedCalls: 0, text: '' },
    undefined,
  );
}

async function execute(launch: ChildLaunch): Promise<void> {
  const { child, hub } = launch;
  if (child.state !== 'queued') {
    release(hub);
    return;
  }
  child.state = 'running';
  child.startedAt = Date.now();
  const limit = child.maxDurationMs ?? 0;
  const watchdog = setTimeout(() => {
    child.abort.abort();
    finish(launch, undefined, 'The child did not stop after its time ran out.');
  }, limit + WATCHDOG_GRACE_MS);
  watchdog.unref();
  let result: AgentResult | undefined;
  let crash: string | undefined;
  try {
    result = await launch.factory(launch.config).run(launch.prompt, {
      title: `Sub-agent ${child.name}`,
      maxToolCalls: launch.maxToolCalls,
      maxDurationMs: child.maxDurationMs,
      budgetProfile: 'long',
      autoContinue: TEAM_CHILD_AUTO_CONTINUE,
      signal: child.abort.signal,
      onEvent: (event) => {
        watch(launch, event);
      },
    });
  } catch (error) {
    crash = error instanceof Error ? error.message : 'The child crashed.';
  }
  clearTimeout(watchdog);
  finish(launch, result, crash);
}

/** Starts the child now when a slot is free, else when one is handed over. */
export function launchChild(launch: ChildLaunch): void {
  const { hub } = launch;
  const begin = (): void => {
    void execute(launch);
  };
  if (hub.active < hub.maxConcurrent) {
    hub.active += 1;
    begin();
  } else {
    hub.queue.push(begin);
  }
}
