import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => {
  const handlers = new Map<string, () => Promise<void>>();
  return {
    handlers,
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    openExternal: vi.fn(),
    writeText: vi.fn(),
    list: vi.fn(),
    trigger: vi.fn(),
    webhook: vi.fn(),
    watcherStart: vi.fn(),
    watcherDispose: vi.fn(),
    checkNow: vi.fn(),
    surface: undefined as ((message: unknown) => void) | undefined,
  };
});

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: string[]) =>
      message.replace(/\{(\d)\}/gu, (_m, index: string) => args[Number(index)] ?? ''),
  },
  window: {
    showInformationMessage: host.showInformationMessage,
    showErrorMessage: host.showErrorMessage,
    showQuickPick: host.showQuickPick,
  },
  env: { openExternal: host.openExternal, clipboard: { writeText: host.writeText } },
  Uri: { parse: (value: string) => ({ parsed: value }) },
  commands: {
    registerCommand: (id: string, handler: () => Promise<void>) => {
      host.handlers.set(id, handler);
      return { dispose: () => undefined };
    },
  },
}));
vi.mock('../../src/backend/remote-job-client', () => ({
  remoteJobClient: () => ({ list: host.list, trigger: host.trigger }),
}));
vi.mock('../../src/backend/channel-client', () => ({
  channelClient: () => ({ webhook: host.webhook }),
}));
vi.mock('../../src/services/channel-inbox-watcher', () => ({
  ChannelInboxWatcher: class {
    constructor(options: { surface: (message: unknown) => void }) {
      host.surface = options.surface;
    }
    start = host.watcherStart;
    dispose = host.watcherDispose;
    checkNow = host.checkNow;
  },
}));

const { registerRemoteChannelCommands } =
  await import('../../src/services/remote-channel-commands');

interface Setup {
  readonly appended: string[];
  readonly update: ReturnType<typeof vi.fn>;
  readonly disposables: { dispose(): void }[];
}

function setup(enabled = false, connected = true): Setup {
  host.handlers.clear();
  const appended: string[] = [];
  const update = vi.fn(async () => undefined);
  const disposables = registerRemoteChannelCommands(
    () => ({ integrationRequest: vi.fn() }) as never,
    { snapshot: { connected } } as never,
    {
      appendToComposer: async (block: string) => {
        appended.push(block);
      },
    },
    { globalState: { get: () => (enabled ? true : undefined), update } } as never,
  );
  return { appended, update, disposables };
}

const message = (url: string | null) => ({
  source: 'ci\nbot',
  title: 'Build broke',
  kind: 'alert',
  body: 'details',
  url,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('remote channel commands', () => {
  it('registers the three commands and starts the watch only when opted in', () => {
    setup(false);
    expect([...host.handlers.keys()].sort()).toEqual([
      'clawAI.checkChannelInbox',
      'clawAI.runRemoteJob',
      'clawAI.showChannelWebhook',
    ]);
    expect(host.watcherStart).not.toHaveBeenCalled();
    setup(true);
    expect(host.watcherStart).toHaveBeenCalledOnce();
  });

  it('disposes the watcher with the first disposable', () => {
    const { disposables } = setup();
    disposables[0]?.dispose();
    expect(host.watcherDispose).toHaveBeenCalledOnce();
  });

  it('says so when there are no remote jobs, and triggers nothing', async () => {
    setup();
    host.list.mockResolvedValue({ jobs: [] });
    await host.handlers.get('clawAI.runRemoteJob')?.();
    expect(host.showInformationMessage.mock.calls[0]?.[0]).toContain('No remote jobs yet');
    expect(host.trigger).not.toHaveBeenCalled();
  });

  it('triggers the picked job with a fresh idempotency key each time', async () => {
    setup();
    host.list.mockResolvedValue({ jobs: [{ id: 'j1', name: 'Deploy', command: 'make ship' }] });
    host.showQuickPick.mockResolvedValue({ id: 'j1', label: 'Deploy' });
    host.trigger.mockResolvedValue({ command: { id: 'cmd1', status: 'QUEUED' } });
    await host.handlers.get('clawAI.runRemoteJob')?.();
    await host.handlers.get('clawAI.runRemoteJob')?.();
    const keys = host.trigger.mock.calls.map((call) => call[1] as string);
    expect(host.trigger.mock.calls[0]?.[0]).toBe('j1');
    expect(keys[0]).not.toBe(keys[1]);
    expect(host.showInformationMessage).toHaveBeenLastCalledWith(
      'Remote job "Deploy" started as command cmd1 (QUEUED).',
    );
  });

  it('does not trigger when the pick is dismissed', async () => {
    setup();
    host.list.mockResolvedValue({ jobs: [{ id: 'j1', name: 'Deploy', command: 'x' }] });
    host.showQuickPick.mockResolvedValue(undefined);
    await host.handlers.get('clawAI.runRemoteJob')?.();
    expect(host.trigger).not.toHaveBeenCalled();
  });

  it('reports a failing trigger instead of throwing', async () => {
    setup();
    host.list.mockResolvedValue({ jobs: [{ id: 'j1', name: 'Deploy', command: 'x' }] });
    host.showQuickPick.mockResolvedValue({ id: 'j1', label: 'Deploy' });
    host.trigger.mockRejectedValue(new Error('device offline'));
    await expect(host.handlers.get('clawAI.runRemoteJob')?.()).resolves.toBeUndefined();
    expect(host.showErrorMessage).toHaveBeenCalledWith(
      'Remote job could not start: device offline',
    );
  });

  it('shows the webhook, turns the watch on and copies only what was chosen', async () => {
    const { update } = setup();
    host.webhook.mockResolvedValue({ url: 'https://hook/1', secret: 'S3CRET' });
    host.showInformationMessage.mockResolvedValue('Copy Secret');
    await host.handlers.get('clawAI.showChannelWebhook')?.();
    expect(update).toHaveBeenCalledWith(expect.any(String), true);
    expect(host.watcherStart).toHaveBeenCalled();
    expect(host.writeText).toHaveBeenCalledExactlyOnceWith('S3CRET');
    expect(JSON.stringify(host.showInformationMessage.mock.calls[0])).not.toContain('S3CRET');
  });

  it('copies the URL when asked, and nothing when dismissed', async () => {
    setup();
    host.webhook.mockResolvedValue({ url: 'https://hook/1', secret: 'S3CRET' });
    host.showInformationMessage.mockResolvedValueOnce('Copy URL');
    await host.handlers.get('clawAI.showChannelWebhook')?.();
    expect(host.writeText).toHaveBeenCalledExactlyOnceWith('https://hook/1');
    host.writeText.mockClear();
    host.showInformationMessage.mockResolvedValueOnce(undefined);
    await host.handlers.get('clawAI.showChannelWebhook')?.();
    expect(host.writeText).not.toHaveBeenCalled();
  });

  it('reports a webhook failure and leaves the watch off', async () => {
    const { update } = setup();
    host.webhook.mockRejectedValue(new Error('403'));
    await host.handlers.get('clawAI.showChannelWebhook')?.();
    expect(host.showErrorMessage).toHaveBeenCalledWith('Channel inbox could not be read: 403');
    expect(update).not.toHaveBeenCalled();
    expect(host.watcherStart).not.toHaveBeenCalled();
  });

  it('checks the inbox: silent when something arrived, told when nothing did', async () => {
    setup();
    host.checkNow.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await host.handlers.get('clawAI.checkChannelInbox')?.();
    expect(host.showInformationMessage).not.toHaveBeenCalled();
    await host.handlers.get('clawAI.checkChannelInbox')?.();
    expect(host.showInformationMessage).toHaveBeenCalledWith('No new channel messages.');
    expect(host.watcherStart).toHaveBeenCalledTimes(2);
  });

  it('reports an inbox failure and does not start the watch', async () => {
    setup();
    host.checkNow.mockRejectedValue(new Error('timeout'));
    await host.handlers.get('clawAI.checkChannelInbox')?.();
    expect(host.showErrorMessage).toHaveBeenCalledWith('Channel inbox could not be read: timeout');
    expect(host.watcherStart).not.toHaveBeenCalled();
  });

  it('surfaces a message on one line and puts it in the composer only on request', async () => {
    const { appended } = setup();
    host.showInformationMessage.mockResolvedValue('Send to Chat');
    host.surface?.(message(null));
    await vi.waitFor(() => {
      expect(appended).toHaveLength(1);
    });
    expect(host.showInformationMessage.mock.calls[0]?.[0]).toBe(
      'Channel message from ci bot: Build broke',
    );
    expect(host.showInformationMessage.mock.calls[0]).toHaveLength(2);
    expect(appended[0]).toContain('Build broke');
    expect(host.openExternal).not.toHaveBeenCalled();
  });

  it('offers Open Link only for a safe link, and opens it on request', async () => {
    setup();
    host.showInformationMessage.mockResolvedValue('Open Link');
    host.surface?.(message('https://ci.example/run/1'));
    await vi.waitFor(() => {
      expect(host.openExternal).toHaveBeenCalledWith({ parsed: 'https://ci.example/run/1' });
    });
    expect(host.showInformationMessage.mock.calls[0]).toContain('Open Link');

    host.showInformationMessage.mockClear();
    host.showInformationMessage.mockResolvedValue(undefined);
    host.surface?.(message('command:workbench.action.reloadWindow'));
    await vi.waitFor(() => {
      expect(host.showInformationMessage).toHaveBeenCalledOnce();
    });
    expect(host.showInformationMessage.mock.calls[0]).not.toContain('Open Link');
  });
});
