import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam, scratch } from './team-fixture';

import type { CallOutcome, ScriptApi } from './team-transport';
import type { AgentConfig } from '../../src/sdk/create-agent.types';

/** What a call gave back as one string: the tool's text on success, the error otherwise. */
export function textOf(outcome: CallOutcome): string {
  if (!outcome.ok) return outcome.message;
  const { value } = outcome.structured;
  return typeof value === 'string' ? value : JSON.stringify(outcome.structured);
}

/** A workspace with `files` written into it (relative path to text or bytes). */
export function workspaceWith(files: Readonly<Record<string, string | Buffer>>): string {
  const root = scratch('claw-adv-');
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

/** Makes a link, or returns false when the platform refuses (no privilege for a symlink). */
export function tryLink(target: string, link: string, kind: 'file' | 'junction'): boolean {
  try {
    mkdirSync(path.dirname(link), { recursive: true });
    symlinkSync(target, link, kind);
    return true;
  } catch {
    return false;
  }
}

/** Runs one lead script with the real agent pipeline over `workspace`. */
export async function asLead(
  workspace: string,
  config: Partial<AgentConfig>,
  script: (api: ScriptApi) => Promise<void>,
): Promise<void> {
  await runTeam({ workspace, config, lead: script });
}
