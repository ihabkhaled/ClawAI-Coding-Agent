import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgent } from '../../src/sdk/create-agent';
import { createNotesStore } from '../../src/sdk/notes-store';

import type { AgentConfig } from '../../src/sdk/create-agent.types';

const created: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function directory(prefix: string): string {
  const made = mkdtempSync(path.join(tmpdir(), prefix));
  created.push(made);
  return made;
}

function seedNotes(state: string, workspace: string): void {
  createNotesStore({ workspace, threadId: () => undefined, stateDirectory: state }).add(
    'plan',
    'an old task',
  );
}

function notesOnDisk(state: string): string {
  const folder = path.join(state, 'notes');
  return readdirSync(folder)
    .map((name) => readFileSync(path.join(folder, name), 'utf8'))
    .join('');
}

function agentConfig(workspaceRoot: string, threadId?: string): AgentConfig {
  return { auth: { token: 't' }, workspaceRoot, ...(threadId === undefined ? {} : { threadId }) };
}

describe('a new agent conversation and its notebook', () => {
  it('starts blank, so notes from an earlier task cannot steer it', () => {
    const state = directory('claw-state-');
    const workspace = directory('claw-ws-');
    vi.stubEnv('CLAW_STATE_DIR', state);
    seedNotes(state, workspace);
    expect(notesOnDisk(state)).toContain('an old task');
    createAgent(agentConfig(workspace));
    expect(notesOnDisk(state)).not.toContain('an old task');
  });

  it('keeps the notes of a resumed conversation untouched', () => {
    const state = directory('claw-state-');
    const workspace = directory('claw-ws-');
    vi.stubEnv('CLAW_STATE_DIR', state);
    seedNotes(state, workspace);
    createAgent(agentConfig(workspace, 'thread-1'));
    expect(notesOnDisk(state)).toContain('an old task');
  });
});
