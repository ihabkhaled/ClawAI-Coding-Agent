import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { vi } from 'vitest';

import { orchestrate } from '../../src/sdk/orchestrate';

import { childName, scratch } from './team-fixture';
import { teamTransport } from './team-transport';

import type { Script, ScriptApi } from './team-transport';
import type { OrchestrateOutcome } from '../../src/sdk/orchestrate';
import type { OrchestrateEvent, OrchestrateOptions } from '../../src/sdk/orchestrate.types';

export { cleanTeamFixtures, makeDir, must, readIn, scratch } from './team-fixture';

export interface OrchestrateRun {
  readonly outcome: OrchestrateOutcome;
  readonly events: OrchestrateEvent[];
  readonly workspace: string;
  readonly state: string;
  readonly starts: ReturnType<typeof teamTransport>['starts'];
}

/** A tiny git repository with one commit, for worktree isolation. */
export function gitWorkspace(): string {
  const dir = scratch('claw-orch-git-');
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  };
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 't');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'README.md'), 'hello\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return dir;
}

/** Runs a plan against scripted agents (keyed by agent name) and returns everything observable. */
export async function runPlan(
  plan: unknown,
  scripts: Readonly<Record<string, Script>>,
  options: {
    readonly workspace?: string;
    readonly ceiling?: OrchestrateOptions['ceiling'];
    readonly config?: Partial<OrchestrateOptions['config']>;
    readonly signal?: AbortSignal;
  } = {},
): Promise<OrchestrateRun> {
  const state = scratch('claw-orch-state-');
  vi.stubEnv('CLAW_STATE_DIR', state);
  const workspace = options.workspace ?? scratch('claw-orch-ws-');
  const { transport, starts, errors } = teamTransport((prompt) => {
    const name = childName(prompt);
    return (
      (name === undefined ? undefined : scripts[name]) ??
      (async (api: ScriptApi) => {
        api.say(`no script for ${String(name)}`);
      })
    );
  });
  const events: OrchestrateEvent[] = [];
  const outcome = await orchestrate(plan, {
    config: { auth: { token: 't' }, transport, ...options.config },
    ceiling: options.ceiling,
    cwd: workspace,
    stateDirectory: state,
    signal: options.signal,
    onEvent: (event) => events.push(event),
  });
  if (errors.length > 0) throw new Error(`a script failed: ${errors.join(' | ')}`);
  return { outcome, events, workspace, state, starts };
}

/** The report of a run that happened. */
export function reportOf(run: OrchestrateRun): Extract<OrchestrateOutcome, { ok: true }>['report'] {
  if (!run.outcome.ok) throw new Error(`plan refused: ${run.outcome.problems.join('; ')}`);
  return run.outcome.report;
}

/** Entries left under `<state>/team` (worktrees); empty when everything was cleaned up. */
export function leftoverWorktrees(state: string): string[] {
  const root = path.join(state, 'team');
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((run) => {
    const full = path.join(root, run);
    return readdirSync(full).filter((name) => !name.endsWith('.patch'));
  });
}

export function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}
