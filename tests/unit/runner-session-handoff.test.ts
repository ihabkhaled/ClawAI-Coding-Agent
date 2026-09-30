import { beforeEach, describe, expect, it, vi } from 'vitest';

const workspace = vi.hoisted(() => ({
  workspaceFolders: [{ name: 'claw-app' }] as { name: string }[] | undefined,
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

import { BackendRequestError } from '../../src/backend/backend-errors';
import {
  buildHandoffSummary,
  newestFirst,
  outcomeOf,
  pollWithBackoff,
} from '../../src/core/session-handoff';
import {
  attachRemoteSession,
  followSession,
  stopRunnerSession,
} from '../../src/services/attach-session-command';
import { offerFollowUp } from '../../src/services/session-followup';

import type { RemoteRequester } from '../../src/backend/remote-session-client';
import type { CloudTask } from '../../src/backend/remote-session-contracts';
import type { RemoteSessionDependencies } from '../../src/services/remote-session-commands.types';
import type { CancellationToken, OutputChannel } from 'vscode';

interface Parser {
  parse(value: unknown): unknown;
}

const runner = { id: 'run-1', hostname: 'build-box', platform: 'linux', status: 'CONNECTED' };
const base = { id: 'cmd-1', sessionId: 'run-1' };
const done = { ...base, status: 'EXECUTED', exitCode: 0, stdout: 'all green', command: 'npm test' };
const live = { ...base, status: 'EXECUTING' };
const tightPolicy = { initialMs: 0, factor: 1, maxDelayMs: 0, maxAttempts: 3 };

function setup(routes: Record<string, unknown>) {
  const calls: { path: string; options: unknown }[] = [];
  const request = vi.fn((path: string, schema: Parser, options?: unknown) => {
    calls.push({ path, options });
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (key === undefined) throw new Error(`unrouted ${path}`);
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
  const revealThread = vi.fn().mockResolvedValue(undefined);
  const dependencies: RemoteSessionDependencies = {
    request: () => request as unknown as RemoteRequester,
    backend: () => backend,
    agentHistory: () => [{ id: 'agent-1', title: 'Existing' }],
    revealThread,
  };
  return { backend, calls, dependencies, revealThread };
}

const notFound = new BackendRequestError('missing', 404, false);
const firstPick = (items: unknown[]) => Promise.resolve(items[0]);
const token = (): CancellationToken => ({
  isCancellationRequested: false,
  onCancellationRequested: vi.fn(),
});
const output = () => ({ appendLine: vi.fn(), show: vi.fn() });
const asChannel = (value: ReturnType<typeof output>) => value as unknown as OutputChannel;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('session handoff core', () => {
  it('reads outcomes from status and exit code', () => {
    expect(outcomeOf({ ...base, status: 'PENDING_APPROVAL' })).toBe('running');
    expect(outcomeOf(done)).toBe('succeeded');
    expect(outcomeOf({ ...done, exitCode: 2 })).toBe('failed');
    expect(outcomeOf({ ...base, status: 'FAILED' })).toBe('failed');
    expect(outcomeOf({ ...base, status: 'CANCELLED' })).toBe('stopped');
  });

  it('redacts secrets and keeps only an output tail in the summary', () => {
    const summary = buildHandoffSummary({
      runnerName: 'build-box',
      task: {
        ...done,
        stdout: `${'x'.repeat(9_000)}\nAuthorization: Bearer abcdefghijklmnop12345678`,
        stderr: 'boom',
      },
    });
    expect(summary).not.toContain('abcdefghijklmnop12345678');
    expect(summary.length).toBeLessThan(5_000);
    expect(summary).toContain('Outcome: succeeded');
    expect(summary).toContain('boom');
  });

  it('orders commands newest first', () => {
    const tasks: CloudTask[] = [
      { ...base, id: 'a', status: 'X', createdAt: '2026-01-01' },
      { ...base, id: 'b', status: 'X', createdAt: '2026-02-01' },
    ];
    expect(newestFirst(tasks).map((task) => task.id)).toEqual(['b', 'a']);
  });

  it('backs off, is bounded, and stops on cancel', async () => {
    const sleeps: number[] = [];
    const read = vi.fn().mockResolvedValue(1);
    const result = await pollWithBackoff({
      read,
      isDone: () => false,
      onUpdate: vi.fn(),
      isCancelled: () => false,
      policy: { initialMs: 10, factor: 2, maxDelayMs: 30, maxAttempts: 4 },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    expect(result).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([10, 20, 30, 30]);
    const cancelled = vi.fn().mockResolvedValue(1);
    await pollWithBackoff({
      read: cancelled,
      isDone: () => false,
      onUpdate: vi.fn(),
      isCancelled: () => true,
      policy: { initialMs: 1, factor: 1, maxDelayMs: 1, maxAttempts: 4 },
      sleep: () => Promise.resolve(),
    });
    expect(cancelled).not.toHaveBeenCalled();
  });
});

describe('followSession', () => {
  it('logs each status once and returns the finished task', async () => {
    const { dependencies } = setup({ '/agent/commands/cmd-1': done });
    const out = output();
    const result = await followSession(
      dependencies,
      { ...base, status: 'EXECUTING' },
      asChannel(out),
      token(),
      tightPolicy,
      () => Promise.resolve(),
    );
    expect(result.status).toBe('EXECUTED');
    expect(out.appendLine).toHaveBeenCalledWith('Session cmd-1: EXECUTED');
  });

  it('gives up after the attempt budget on a session that never finishes', async () => {
    const { dependencies, calls } = setup({ '/agent/commands/cmd-1': live });
    const result = await followSession(
      dependencies,
      { ...base, status: 'EXECUTING' },
      asChannel(output()),
      token(),
      tightPolicy,
      () => Promise.resolve(),
    );
    expect(result.status).toBe('EXECUTING');
    expect(calls).toHaveLength(3);
  });

  it('treats a vanished command as expired instead of failing', async () => {
    const { dependencies } = setup({ '/agent/commands/cmd-1': notFound });
    const result = await followSession(
      dependencies,
      { ...base, status: 'EXECUTING' },
      asChannel(output()),
      token(),
    );
    expect(result.status).toBe('EXPIRED');
  });
});

describe('attachRemoteSession', () => {
  it('says so when the backend does not list runner sessions', async () => {
    const { dependencies } = setup({ '/agent/sessions': notFound });
    await attachRemoteSession(dependencies);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'This backend does not list runner sessions yet.',
    );
  });

  it('says so when the account has no runner sessions', async () => {
    const { dependencies } = setup({ '/agent/sessions': { data: [] } });
    await attachRemoteSession(dependencies);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No runner sessions were found for this account.',
    );
  });

  it('says so when the commands route is missing', async () => {
    const { dependencies } = setup({
      '/agent/sessions': { data: [runner] },
      '/agent/commands': notFound,
    });
    window.showQuickPick.mockImplementation(firstPick);
    await attachRemoteSession(dependencies);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'No matching commands were found on build-box.',
    );
  });

  it('shows a finished session and continues it in a new thread', async () => {
    const { dependencies, backend, revealThread } = setup({
      '/agent/sessions': { data: [runner] },
      '/agent/commands': { data: [done] },
    });
    window.showQuickPick.mockImplementation(firstPick);
    const out = output();
    window.createOutputChannel.mockReturnValue(out);
    window.showInformationMessage.mockResolvedValueOnce('Open in Chat');

    await attachRemoteSession(dependencies);

    expect(window.withProgress).not.toHaveBeenCalled();
    expect(out.appendLine).toHaveBeenCalledWith('all green');
    expect(backend.createThread).toHaveBeenCalledTimes(1);
    const sent = backend.sendMessage.mock.calls[0]?.[0] as { threadId: string; content: string };
    expect(sent.threadId).toBe('new-thread');
    expect(sent.content).toContain('all green');
    expect(revealThread).toHaveBeenCalledWith('new-thread', 'New conversation');
  });

  it('shows a failed session with its exit code', async () => {
    const failed = { ...base, status: 'FAILED', exitCode: 1, stderr: 'no tests' };
    const { dependencies } = setup({
      '/agent/sessions': { data: [runner] },
      '/agent/commands': { data: [failed] },
    });
    window.showQuickPick.mockImplementation(firstPick);
    const out = output();
    window.createOutputChannel.mockReturnValue(out);
    await attachRemoteSession(dependencies);
    expect(out.appendLine).toHaveBeenCalledWith('no tests');
    expect(window.showInformationMessage.mock.calls[0]?.[0]).toBe(
      'Session cmd-1 finished with status FAILED.',
    );
  });

  it('follows a running session with reads only and offers stop', async () => {
    const { dependencies, calls } = setup({
      '/agent/sessions': { data: [runner] },
      '/agent/commands': { data: [live] },
    });
    window.showQuickPick.mockImplementation(firstPick);
    window.createOutputChannel.mockReturnValue(output());
    window.withProgress.mockResolvedValue(live);
    window.showInformationMessage.mockResolvedValueOnce(undefined);

    await attachRemoteSession(dependencies);

    expect(window.withProgress).toHaveBeenCalledTimes(1);
    expect(calls.every((call) => call.options === undefined)).toBe(true);
    expect(window.showInformationMessage.mock.calls[0]).toContain('Stop Session');
  });
});

describe('offerFollowUp and stop', () => {
  it('posts into an existing thread', async () => {
    const { dependencies, backend, revealThread } = setup({});
    window.showInformationMessage.mockResolvedValueOnce('Open in Chat');
    window.showQuickPick.mockImplementation((items: unknown[]) => Promise.resolve(items[1]));
    await offerFollowUp(dependencies, done, 'build-box');
    expect(backend.createThread).not.toHaveBeenCalled();
    expect(backend.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'agent-1' }),
    );
    expect(revealThread).toHaveBeenCalledWith('agent-1', 'Existing');
  });

  it('does nothing when the thread pick is dismissed', async () => {
    const { dependencies, backend } = setup({});
    window.showInformationMessage.mockResolvedValueOnce('Open in Chat');
    window.showQuickPick.mockResolvedValue(undefined);
    await offerFollowUp(dependencies, done, 'build-box');
    expect(backend.sendMessage).not.toHaveBeenCalled();
  });

  it('reports an older backend that cannot post the handoff', async () => {
    const { dependencies, backend } = setup({});
    backend.sendMessage.mockRejectedValue(new BackendRequestError('nope', 501, false));
    window.showInformationMessage.mockResolvedValueOnce('Open in Chat');
    window.showQuickPick.mockImplementation(firstPick);
    await offerFollowUp(dependencies, done, 'build-box');
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'This backend cannot take the session into a conversation yet.',
    );
  });

  it('cancels a running command through the cancel endpoint', async () => {
    const { dependencies, calls } = setup({
      '/agent/commands/cmd-1/cancel': { ...live, status: 'CANCELLED' },
    });
    window.showInformationMessage.mockResolvedValueOnce('Stop Session');
    await offerFollowUp(dependencies, live, 'build-box');
    expect(calls[0]?.path).toBe('/agent/commands/cmd-1/cancel');
    expect(calls[0]?.options).toMatchObject({ method: 'POST' });
  });

  it('says when the backend has no cancel route', async () => {
    const { dependencies } = setup({ '/agent/commands/cmd-1/cancel': notFound });
    window.showInformationMessage.mockResolvedValueOnce('Stop Session');
    await offerFollowUp(dependencies, live, 'build-box');
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'This backend cannot stop a runner session.',
    );
  });

  it('stopRunnerSession lists only unfinished commands', async () => {
    const { dependencies, calls } = setup({
      '/agent/sessions': { data: [runner] },
      '/agent/commands?': { data: [done, live] },
      '/agent/commands/cmd-1/cancel': { ...live, status: 'CANCELLED' },
    });
    window.showQuickPick.mockImplementation(firstPick);
    await stopRunnerSession(dependencies);
    const items = window.showQuickPick.mock.calls[1]?.[0] as unknown[];
    expect(items).toHaveLength(1);
    expect(calls.at(-1)?.path).toBe('/agent/commands/cmd-1/cancel');
  });
});
