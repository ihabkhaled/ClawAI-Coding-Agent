import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { vi } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';

import { teamTransport } from './team-transport';

import type { Script, ScriptApi } from './team-transport';
import type { AgentConfig, AgentEvent, AgentResult } from '../../src/sdk/create-agent.types';

const created: string[] = [];

export function cleanTeamFixtures(): void {
  vi.unstubAllEnvs();
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
}

export function scratch(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

export interface TeamRun {
  readonly result: AgentResult;
  readonly events: AgentEvent[];
  readonly workspace: string;
  readonly state: string;
  readonly starts: ReturnType<typeof teamTransport>['starts'];
}

export interface TeamRunOptions {
  readonly lead: Script;
  /** Scripts for children, keyed by the name in `sub-agent "name"`. */
  readonly children?: Readonly<Record<string, Script>>;
  readonly config?: Partial<AgentConfig>;
  readonly workspace?: string;
  readonly maxToolCalls?: number;
  readonly maxDurationMs?: number;
  readonly signal?: AbortSignal;
}

/** The structured result of a call that must have worked. */
export function must(outcome: {
  ok: boolean;
  structured: Record<string, unknown>;
  message: string;
}): Record<string, unknown> {
  if (!outcome.ok) throw new Error(`call failed: ${outcome.message}`);
  return outcome.structured;
}

export function childName(prompt: string): string | undefined {
  return /sub-agent "([a-z0-9-]+)"/u.exec(prompt)?.[1];
}

/** Runs a lead script with child scripts and returns everything observable. */
export async function runTeam(options: TeamRunOptions): Promise<TeamRun> {
  const state = scratch('claw-team-state-');
  vi.stubEnv('CLAW_STATE_DIR', state);
  const workspace = options.workspace ?? scratch('claw-team-ws-');
  const { transport, starts, errors } = teamTransport((prompt) => {
    const name = childName(prompt);
    if (name === undefined) return options.lead;
    return (
      options.children?.[name] ??
      (async (api: ScriptApi) => {
        api.say(`no script for ${name}`);
      })
    );
  });
  const events: AgentEvent[] = [];
  const agent = createAgent({
    auth: { token: 't' },
    workspaceRoot: workspace,
    transport,
    permissions: { allow: ['read', 'write', 'command', 'git', 'agents'] },
    ...options.config,
  });
  const result = await agent.run('LEAD: do the work', {
    onEvent: (event) => events.push(event),
    maxToolCalls: options.maxToolCalls,
    budgetProfile: 'long',
    maxDurationMs: options.maxDurationMs,
    signal: options.signal,
  });
  if (errors.length > 0) throw new Error(`a script failed: ${errors.join(' | ')}`);
  return { result, events, workspace, state, starts };
}

export function readIn(workspace: string, relative: string): string | undefined {
  const file = path.join(workspace, relative);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
}

export function makeDir(workspace: string, relative: string): string {
  const full = path.join(workspace, relative);
  mkdirSync(full, { recursive: true });
  return full;
}
