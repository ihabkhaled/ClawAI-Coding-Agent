import { beforeEach, describe, expect, it, vi } from 'vitest';

const window = vi.hoisted(() => ({
  showQuickPick: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showInputBox: vi.fn(),
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
  commands: { registerCommand: vi.fn((id: string) => ({ id, dispose: vi.fn() })) },
  ProgressLocation: { Notification: 15 },
}));

import { startCloudSession, watchCloudTask } from '../../src/services/cloud-session-command';
import { registerRemoteSessionCommands } from '../../src/services/remote-session-commands';
import { resumeConversation } from '../../src/services/resume-conversation-command';

import type { BackendClient } from '../../src/backend/backend-client';
import type { RemoteRequester } from '../../src/backend/remote-session-client';
import type { ExtensionState } from '../../src/core/extension-state';
import type { RemoteSessionDependencies } from '../../src/services/remote-session-commands.types';
import type { OutputChannel } from 'vscode';

interface Parser {
  parse(value: unknown): unknown;
}

function setup(routes: Record<string, unknown>) {
  const calls: { path: string; options: unknown }[] = [];
  const remoteRequest = vi.fn((path: string, schema: Parser, options?: unknown) => {
    calls.push({ path, options });
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (key === undefined) throw new Error(`unrouted ${path}`);
    return Promise.resolve(schema.parse(routes[key]));
  });
  const backend = {
    integrationRequest: remoteRequest,
    listMessages: vi.fn().mockResolvedValue([]),
    cancelStream: vi.fn().mockResolvedValue(undefined),
  };
  const revealThread = vi.fn().mockResolvedValue('session-1');
  const dependencies: RemoteSessionDependencies = {
    request: () => remoteRequest as unknown as RemoteRequester,
    backend: () => backend,
    agentHistory: () => [{ id: 'agent-1', title: 'From the CLI' }],
    revealThread,
  };
  return { backend, calls, dependencies, revealThread };
}

function page(data: unknown[]) {
  return { data, meta: { total: data.length, page: 1, limit: 50, totalPages: 1 } };
}

const firstPick = (items: unknown[]) => Promise.resolve(items[0]);

const onlineRunner = { id: 'run-1', hostname: 'build-box', platform: 'linux', status: 'CONNECTED' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerRemoteSessionCommands', () => {
  it('registers both commands', () => {
    const { backend, revealThread } = setup({});
    const state = { snapshot: { history: [] } } as unknown as Pick<ExtensionState, 'snapshot'>;
    const disposables = registerRemoteSessionCommands(
      () => backend as unknown as BackendClient,
      state,
      { revealThread },
    );
    const ids = disposables.map((item) => (item as unknown as { id: string }).id);
    expect(ids).toEqual(['clawAI.resumeConversation', 'clawAI.startCloudSession']);
  });
});

describe('resumeConversation', () => {
  it('offers agent and web threads once each, then opens the pick with its history', async () => {
    const { calls, dependencies, revealThread } = setup({
      '/chat-threads': page([
        { id: 'web-1', title: 'Portal chat', origin: 'WEB' },
        { id: 'agent-1', title: 'dup', origin: 'WEB' },
      ]),
    });
    window.showQuickPick.mockImplementation((items: unknown[]) => Promise.resolve(items[1]));

    await resumeConversation(dependencies);

    expect(calls[0]?.path).toBe('/chat-threads?limit=50&origin=WEB');
    const offered = window.showQuickPick.mock.calls[0]?.[0] as {
      label: string;
      description: string;
    }[];
    expect(offered.map((item) => [item.label, item.description])).toEqual([
      ['From the CLI', 'Coding agent'],
      ['Portal chat', 'Web'],
    ]);
    expect(revealThread).toHaveBeenCalledWith('web-1', 'Portal chat');
  });

  it('stops a run still live elsewhere before opening, when asked to', async () => {
    const { backend, dependencies, revealThread } = setup({ '/chat-threads': page([]) });
    backend.listMessages.mockResolvedValue([{ role: 'USER' }]);
    window.showQuickPick.mockImplementation(firstPick);
    window.showWarningMessage.mockResolvedValue('Stop That Run');

    await resumeConversation(dependencies);

    expect(backend.cancelStream).toHaveBeenCalledWith('agent-1');
    expect(revealThread).toHaveBeenCalledWith('agent-1', 'From the CLI');
  });

  it('opens nothing when the live-run warning is dismissed', async () => {
    const { backend, dependencies, revealThread } = setup({ '/chat-threads': page([]) });
    backend.listMessages.mockResolvedValue([{ role: 'USER' }]);
    window.showQuickPick.mockImplementation(firstPick);
    window.showWarningMessage.mockResolvedValue(undefined);

    await resumeConversation(dependencies);

    expect(backend.cancelStream).not.toHaveBeenCalled();
    expect(revealThread).not.toHaveBeenCalled();
  });
});

function outputChannel() {
  return { appendLine: vi.fn(), show: vi.fn() };
}

describe('startCloudSession', () => {
  it('says there is no hosted capacity when no runner is online', async () => {
    const { calls, dependencies } = setup({ '/agent/sessions': { data: [] } });

    await startCloudSession(dependencies);

    expect(calls[0]?.path).toBe('/agent/sessions?status=CONNECTED&pageSize=50');
    expect(String(window.showWarningMessage.mock.calls[0]?.[0])).toContain('no hosted runners');
  });

  it('dispatches a branch-bound command to the picked runner and watches it', async () => {
    const repo = { id: 'r', sessionId: 'run-1', name: 'app', repoPath: '/src/app', branch: 'main' };
    const task = { id: 'cmd-1', sessionId: 'run-1', status: 'EXECUTED', stdout: 'ok', exitCode: 0 };
    const { calls, dependencies } = setup({
      '/agent/sessions': { data: [onlineRunner] },
      '/agent/repos': { data: [repo] },
      '/agent/commands': task,
    });
    window.showQuickPick.mockImplementation(firstPick);
    window.showInputBox.mockResolvedValueOnce('main').mockResolvedValueOnce('npm test');
    const output = outputChannel();
    window.createOutputChannel.mockReturnValue(output);
    window.withProgress.mockImplementation(
      (_options: unknown, run: (progress: unknown, token: unknown) => unknown) =>
        run({}, { isCancellationRequested: false }),
    );

    await startCloudSession(dependencies);

    expect(calls.find((call) => call.path === '/agent/commands')?.options).toEqual({
      method: 'POST',
      body: {
        sessionId: 'run-1',
        workingDir: '/src/app',
        command: 'git checkout main && npm test',
      },
    });
    expect(calls.at(-1)?.path).toBe('/agent/commands/cmd-1');
    expect(output.appendLine).toHaveBeenCalledWith('Cloud session cmd-1: EXECUTED');
    expect(output.appendLine).toHaveBeenCalledWith('ok');
  });

  it('refuses an unsafe branch without dispatching', async () => {
    const { calls, dependencies } = setup({
      '/agent/sessions': { data: [onlineRunner] },
      '/agent/repos': { data: [{ id: 'r', sessionId: 'run-1', name: 'app', repoPath: '/a' }] },
    });
    window.showQuickPick.mockImplementation(firstPick);
    window.showInputBox.mockResolvedValueOnce('main;rm -rf ~').mockResolvedValueOnce('npm test');

    await startCloudSession(dependencies);

    expect(window.showErrorMessage).toHaveBeenCalled();
    expect(calls.some((call) => call.path === '/agent/commands')).toBe(false);
  });

  it('stops when the runner reports no repositories', async () => {
    const { dependencies } = setup({
      '/agent/sessions': { data: [onlineRunner] },
      '/agent/repos': { data: [] },
    });
    window.showQuickPick.mockImplementation(firstPick);

    await startCloudSession(dependencies);

    expect(window.showWarningMessage).toHaveBeenCalledWith(
      'This runner has reported no repositories.',
    );
  });
});

describe('watchCloudTask', () => {
  it('writes each status once and gives up after the poll budget', async () => {
    const output = outputChannel();
    const read = vi.fn().mockResolvedValue({ id: 'c', sessionId: 's', status: 'PENDING_APPROVAL' });

    const result = await watchCloudTask(
      read,
      output as unknown as OutputChannel,
      { isCancellationRequested: false, onCancellationRequested: vi.fn() },
      { intervalMs: 0, maxPolls: 3 },
    );

    expect(result).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(3);
    expect(output.appendLine).toHaveBeenCalledTimes(1);
  });
});
