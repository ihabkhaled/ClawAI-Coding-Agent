import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workspace = vi.hoisted(() => ({
  workspaceFolders: [] as { name: string; uri: { fsPath: string } }[],
}));

const window = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createOutputChannel: vi.fn(),
  withProgress: vi.fn(),
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      args.reduce<string>(
        (text, arg, index) => text.replace(`{${String(index)}}`, String(arg)),
        message,
      ),
  },
  window,
  workspace,
  ProgressLocation: { Notification: 15 },
}));

import { agentRemoteClient } from '../../src/backend/agent-remote-client';
import { BackendRequestError } from '../../src/backend/backend-errors';
import { attachRemoteSession, pickRunnerSession } from '../../src/services/attach-session-command';

import type { RemoteRequester } from '../../src/backend/remote-session-client';
import type { RemoteSessionDependencies } from '../../src/services/remote-session-commands.types';

interface Parser {
  parse(value: unknown): unknown;
}

const runner = { id: 'run-1', hostname: 'build-box', platform: 'linux', status: 'CONNECTED' };
const done = {
  id: 'cmd-1',
  sessionId: 'run-1',
  status: 'EXECUTED',
  exitCode: 0,
  stdout: 'ok',
  command: 'npm test',
};
const notFound = new BackendRequestError('missing', 404, false);
const TOKEN = 'tok-not-a-real-credential-4412';

function setup(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const request = vi.fn((path_: string, schema: Parser) => {
    calls.push(path_);
    const key = Object.keys(routes).find((prefix) => path_.startsWith(prefix));
    if (key === undefined) throw new Error(`unrouted ${path_}`);
    const routed = routes[key];
    if (routed instanceof Error) return Promise.reject(routed);
    return Promise.resolve(schema.parse(routed));
  });
  const backend = {
    listMessages: vi.fn(),
    cancelStream: vi.fn(),
    createThread: vi.fn().mockResolvedValue({ id: 'new-thread' }),
    sendMessage: vi.fn().mockResolvedValue({}),
  };
  const dependencies: RemoteSessionDependencies = {
    request: () => request as unknown as RemoteRequester,
    backend: () => backend,
    agentHistory: () => [],
    revealThread: vi.fn().mockResolvedValue(undefined),
  };
  return { backend, calls, dependencies };
}

const firstPick = (items: unknown[]) => Promise.resolve(items[0]);
const made: string[] = [];

function gitCheckout(remote: string | undefined): string {
  const root = mkdtempSync(path.join(tmpdir(), 'claw-attach-'));
  made.push(root);
  mkdirSync(path.join(root, '.git'));
  writeFileSync(
    path.join(root, '.git', 'config'),
    remote === undefined ? '[core]\n' : `[remote "origin"]\n\turl = ${remote}\n`,
  );
  writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  workspace.workspaceFolders = [];
});
afterEach(() => {
  for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('the runner row shows the policy verdict', () => {
  const sessions = { '/agent/sessions': { data: [runner] } };

  it('adds a plain sentence for a runner that is not compliant', async () => {
    const { dependencies } = setup({
      ...sessions,
      '/agent/runners': [
        {
          id: 'run-1',
          compliance: {
            status: 'noncompliant',
            reason: 'version_below_minimum,platform_not_allowed',
          },
        },
      ],
    });
    window.showQuickPick.mockImplementation(firstPick);
    await pickRunnerSession(dependencies);
    const items = window.showQuickPick.mock.calls[0]?.[0] as { detail?: string }[];
    expect(items[0]?.detail).toBe(
      'Policy: not compliant, version is below the organization minimum, platform is not allowed',
    );
  });

  it('says compliant, and could not be checked, in words', async () => {
    const compliant = setup({
      ...sessions,
      '/agent/runners': {
        data: [{ id: 'run-1', compliance: { status: 'compliant', reason: null } }],
      },
    });
    window.showQuickPick.mockImplementation(firstPick);
    await pickRunnerSession(compliant.dependencies);
    const unknown = setup({
      ...sessions,
      '/agent/runners': [
        { id: 'run-1', compliance: { status: 'unknown', reason: 'version_missing' } },
      ],
    });
    await pickRunnerSession(unknown.dependencies);
    const first = window.showQuickPick.mock.calls[0]?.[0] as { detail?: string }[];
    const second = window.showQuickPick.mock.calls[1]?.[0] as { detail?: string }[];
    expect(first[0]?.detail).toBe('Policy: compliant');
    expect(second[0]?.detail).toBe('Policy: could not be checked, no version was reported');
  });

  it('shows no policy line when there is no verdict (policy off)', async () => {
    const { dependencies } = setup({
      ...sessions,
      '/agent/runners': [{ id: 'run-1', compliance: null }],
    });
    window.showQuickPick.mockImplementation(firstPick);
    await pickRunnerSession(dependencies);
    const items = window.showQuickPick.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(items[0]).not.toHaveProperty('detail');
  });

  it('still lists the runner against an older backend that has no runners route', async () => {
    const { dependencies } = setup({ ...sessions, '/agent/runners': notFound });
    window.showQuickPick.mockImplementation(firstPick);
    const picked = await pickRunnerSession(dependencies);
    expect(picked?.id).toBe('run-1');
  });
});

describe('the heartbeat report', () => {
  it('sends agentVersion and platform, and nothing else', async () => {
    const request = vi.fn().mockResolvedValue({});
    await agentRemoteClient.runnerHeartbeat(request, 'runner-token', {
      agentVersion: '1.95.0',
      platform: 'linux',
    });
    expect(request.mock.calls[0]?.[0]).toBe('/agent/runners/heartbeat');
    expect(request.mock.calls[0]?.[3]).toEqual({
      method: 'POST',
      body: { agentVersion: '1.95.0', platform: 'linux' },
    });
  });

  it('still sends a bodyless heartbeat when no report is given', async () => {
    const request = vi.fn().mockResolvedValue({});
    await agentRemoteClient.runnerHeartbeat(request, 'runner-token');
    expect(request.mock.calls[0]?.[3]).toEqual({ method: 'POST' });
  });
});

describe('attaching reads the resume manifest and tags the thread', () => {
  const routes = (resume: unknown) => ({
    '/agent/sessions': { data: [runner] },
    '/agent/commands': { data: [done] },
    '/agent/runners/run-1/resume': resume,
    '/agent/repos': { data: [] },
  });

  async function attach(resume: unknown) {
    const harness = setup(routes(resume));
    const lines: string[] = [];
    window.showQuickPick.mockImplementation(firstPick);
    window.createOutputChannel.mockReturnValue({
      appendLine: (line: string) => lines.push(line),
      show: vi.fn(),
    });
    window.showInformationMessage.mockResolvedValueOnce('Open in Chat');
    await attachRemoteSession(harness.dependencies);
    return { ...harness, lines };
  }

  it('passes a credential-stripped repositoryRef to createThread', async () => {
    workspace.workspaceFolders = [
      {
        name: 'app',
        uri: { fsPath: gitCheckout(`https://deploy:${TOKEN}@github.com/acme/app.git`) },
      },
    ];
    const { backend, calls } = await attach({ runner: { id: 'run-1' }, online: true });
    expect(calls).toContain('/agent/runners/run-1/resume');
    const input = backend.createThread.mock.calls[0]?.[0] as { repositoryRef?: unknown };
    expect(input.repositoryRef).toMatchObject({
      remoteUrl: 'https://github.com/acme/app',
      branch: 'main',
    });
    expect(JSON.stringify(backend.createThread.mock.calls)).not.toContain(TOKEN);
  });

  it('sends no repositoryRef for a workspace with no git remote', async () => {
    workspace.workspaceFolders = [{ name: 'app', uri: { fsPath: gitCheckout(undefined) } }];
    const { backend } = await attach({ runner: { id: 'run-1' }, online: true });
    expect(backend.createThread.mock.calls[0]?.[0]).not.toHaveProperty('repositoryRef');
  });

  it('ignores a 404 from an older backend and still continues', async () => {
    workspace.workspaceFolders = [];
    const { backend, lines } = await attach(notFound);
    expect(backend.createThread).toHaveBeenCalledTimes(1);
    expect(lines.join('\n')).not.toContain('not connected');
  });

  it('says plainly when the runner is no longer connected', async () => {
    const { lines } = await attach({ runner: { id: 'run-1' }, online: false });
    expect(lines).toContain('Runner build-box is not connected now.');
  });
});
