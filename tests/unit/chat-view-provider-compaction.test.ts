import { describe, expect, it, vi } from 'vitest';

const panelQueue = vi.hoisted(() => ({ panels: [] as unknown[] }));

vi.mock('vscode', () => ({
  env: { language: 'en' },
  ViewColumn: { Active: -1 },
  window: {
    tabGroups: { all: [] },
    createWebviewPanel: () => panelQueue.panels.shift(),
  },
  l10n: { t: (message: string) => message },
  Uri: {
    joinPath: (...segments: { path: string }[]) => ({
      path: segments.map((segment) => segment.path).join('/'),
      toString: () => segments.map((segment) => segment.path).join('/'),
    }),
  },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { createRuntimeSnapshot } from '../../src/core/runtime/runtime-event-reducer';
import { ChatViewProvider } from '../../src/webview/chat-view-provider';

const ID = '11111111-1111-4111-8111-111111111111';

function state(): ExtensionState {
  return new ExtensionState({
    agentMode: 'AUTO',
    viewDensity: 'full',
    effortMode: 'ULTRA',
    speedMode: '1X',
    agentRun: undefined,
    agentRuns: {},
    approvalRequest: undefined,
    questionRequest: undefined,
    findings: [],
    tasks: [],
    artifacts: [],
    organizationPolicy: undefined,
    backendStatus: 'connected',
    backendUrl: 'https://claw.local',
    busy: false,
    connected: true,
    contextReceipt: undefined,
    entitlements: undefined,
    generationQueue: { active: [], capacity: 2, pending: [] },
    history: [],
    lastError: undefined,
    modelWarnings: [],
    models: [],
    permissionMode: 'MANUAL',
    routingMode: 'MANUAL_MODEL',
    runtime: createRuntimeSnapshot(),
    selectedModel: 'OLLAMA:llama3',
    usage: undefined,
    user: { id: 'user-1' } as never,
    workspaceReadiness: undefined,
    workspaceScope: { folders: [] },
  });
}

interface Editor {
  readonly posted: Record<string, unknown>[];
  readonly close: () => void;
  readonly receive: (message: unknown) => void;
}

/** A stand-in for one editor tab; queue it before the provider opens a session. */
function editor(): Editor {
  const posted: Record<string, unknown>[] = [];
  let receive: (message: unknown) => void = () => undefined;
  let dispose: () => void = () => undefined;
  const panel = {
    active: false,
    dispose: vi.fn(),
    iconPath: undefined,
    onDidChangeViewState: vi.fn(),
    onDidDispose: (handler: () => void) => {
      dispose = handler;
    },
    title: '',
    viewColumn: undefined,
    webview: {
      asWebviewUri: (uri: { toString: () => string }) => uri,
      cspSource: 'vscode-webview://test',
      html: '',
      options: {},
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        receive = handler;
      },
      postMessage: async (message: Record<string, unknown>) => {
        posted.push(message);
        return true;
      },
    },
  };
  panelQueue.panels.push(panel);
  return {
    posted,
    close: () => {
      dispose();
    },
    receive: (message) => {
      receive(message);
    },
  };
}

async function openThread(
  provider: ChatViewProvider,
  tab: Editor,
  threadId: string,
): Promise<string> {
  const sessionId = await provider.reveal();
  await provider.updateSession(sessionId, { threadId });
  tab.posted.length = 0;
  return sessionId;
}

function sidebar() {
  const posted: Record<string, unknown>[] = [];
  const compactionDecision = vi.fn(async (_id: string, _accept: boolean) => undefined);
  const compactionOfferAbandoned = vi.fn(async (_id: string) => undefined);
  let receive: (message: unknown) => void = () => undefined;
  const provider = new ChatViewProvider({ path: '/ext' } as never, state(), {
    compactionDecision,
    compactionOfferAbandoned,
  } as never);
  provider.resolveWebviewView({
    webview: {
      asWebviewUri: (uri: { toString: () => string }) => uri,
      cspSource: 'vscode-webview://test',
      html: '',
      options: {},
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        receive = handler;
      },
      postMessage: async (message: Record<string, unknown>) => {
        posted.push(message);
        return true;
      },
    },
    onDidDispose: vi.fn(),
  } as never);
  posted.length = 0;
  return {
    compactionDecision,
    compactionOfferAbandoned,
    posted,
    provider,
    receive: (message: unknown) => {
      receive(message);
    },
  };
}

describe('ChatViewProvider compaction offer', () => {
  it('reports it could not deliver when no open panel holds the conversation', async () => {
    const seat = sidebar();

    const delivered = await seat.provider.postCompactionOffer({
      requestId: ID,
      threadId: 'thread-1',
      usedPercent: 91,
    });

    expect(delivered).toBe(false);
    expect(seat.posted).toEqual([]);
  });

  it('refuses to deliver a malformed offer', async () => {
    const seat = sidebar();

    expect(
      await seat.provider.postCompactionOffer({ requestId: 'bad', threadId: 't', usedPercent: 1 }),
    ).toBe(false);
  });

  it('routes a valid decision to the host action', async () => {
    const seat = sidebar();

    seat.receive({ type: 'compactionDecision', requestId: ID, accept: true });
    await vi.waitFor(() => {
      expect(seat.compactionDecision).toHaveBeenCalledWith(ID, true);
    });
  });

  it('rejects a malformed decision without reaching the host action', async () => {
    const seat = sidebar();

    seat.receive({ type: 'compactionDecision', requestId: 'x', accept: 'yes' });
    await vi.waitFor(() => {
      expect(seat.posted).toEqual([
        { type: 'error', message: 'The ClawAI view sent an invalid request.' },
      ]);
    });
    expect(seat.compactionDecision).not.toHaveBeenCalled();
  });
});

const ID_TWO = '22222222-2222-4222-8222-222222222222';
const OFFER = { requestId: ID, threadId: 'thread-1', usedPercent: 91 };
const OFFER_MESSAGE = { type: 'compactionOffer', ...OFFER };

describe('ChatViewProvider compaction offer delivery', () => {
  it('posts the offer to the panel holding the thread and reports it delivered', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');

    expect(await seat.provider.postCompactionOffer(OFFER)).toBe(true);
    expect(tab.posted).toEqual([OFFER_MESSAGE]);
    expect(seat.provider.holdsThread('thread-1')).toBe(true);
    expect(seat.provider.holdsThread('other')).toBe(false);
  });

  it('posts the offer again on ready until the panel confirms it is shown', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);
    tab.posted.length = 0;

    tab.receive({ type: 'ready' });
    await vi.waitFor(() => {
      expect(tab.posted.filter((message) => message.type === 'compactionOffer')).toEqual([
        OFFER_MESSAGE,
      ]);
    });

    tab.receive({ type: 'compactionOfferShown', requestId: ID });
    tab.posted.length = 0;
    tab.receive({ type: 'ready' });
    await vi.waitFor(() => {
      expect(tab.posted.some((message) => message.type === 'session')).toBe(true);
    });
    expect(tab.posted.some((message) => message.type === 'compactionOffer')).toBe(false);
  });

  it('posts an unconfirmed offer again after a session message', async () => {
    const seat = sidebar();
    const tab = editor();
    const sessionId = await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);
    tab.posted.length = 0;

    await seat.provider.updateSession(sessionId, { subject: 'renamed' });

    expect(tab.posted.map((message) => message.type)).toEqual(['session', 'compactionOffer']);
  });

  it('does not deliver an offer for a thread no panel holds', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');

    expect(await seat.provider.postCompactionOffer({ ...OFFER, threadId: 'other' })).toBe(false);
    expect(tab.posted).toEqual([]);
  });

  it('ignores a confirmation for an id it never posted', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);

    tab.receive({ type: 'compactionOfferShown', requestId: ID_TWO });
    tab.posted.length = 0;
    tab.receive({ type: 'ready' });

    await vi.waitFor(() => {
      expect(tab.posted.some((message) => message.type === 'compactionOffer')).toBe(true);
    });
  });

  it('rejects a malformed confirmation', async () => {
    const seat = sidebar();

    seat.receive({ type: 'compactionOfferShown', requestId: 'x' });

    await vi.waitFor(() => {
      expect(seat.posted).toEqual([
        { type: 'error', message: 'The ClawAI view sent an invalid request.' },
      ]);
    });
  });

  it('tells every panel to drop the card once one panel answers', async () => {
    const seat = sidebar();
    const first = editor();
    const second = editor();
    await openThread(seat.provider, first, 'thread-1');
    await openThread(seat.provider, second, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);
    first.posted.length = 0;
    second.posted.length = 0;

    first.receive({ type: 'compactionDecision', requestId: ID, accept: false });

    await vi.waitFor(() => {
      expect(seat.compactionDecision).toHaveBeenCalledWith(ID, false);
    });
    const closed = { type: 'compactionOfferClosed', requestId: ID };
    expect(first.posted).toContainEqual(closed);
    expect(second.posted).toContainEqual(closed);
    expect(seat.posted).toContainEqual(closed);
  });

  it('closes the card and surfaces the failure when the compaction throws', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);
    seat.compactionDecision.mockRejectedValueOnce(new Error('summary failed'));
    tab.posted.length = 0;

    tab.receive({ type: 'compactionDecision', requestId: ID, accept: true });

    await vi.waitFor(() => {
      expect(tab.posted).toContainEqual({ type: 'error', message: 'summary failed' });
    });
    expect(tab.posted).toContainEqual({ type: 'compactionOfferClosed', requestId: ID });
  });
});

describe('ChatViewProvider abandoned compaction offers', () => {
  it('lifts the mark when the panel closes with the offer unanswered', async () => {
    const seat = sidebar();
    const tab = editor();
    await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);

    tab.close();

    await vi.waitFor(() => {
      expect(seat.compactionOfferAbandoned).toHaveBeenCalledWith(ID);
    });
  });

  it('lifts the mark when the panel moves to another thread', async () => {
    const seat = sidebar();
    const tab = editor();
    const sessionId = await openThread(seat.provider, tab, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);

    await seat.provider.updateSession(sessionId, { threadId: 'thread-2' });

    expect(seat.compactionOfferAbandoned).toHaveBeenCalledWith(ID);
  });

  it('keeps the offer while another panel still holds the thread', async () => {
    const seat = sidebar();
    const first = editor();
    const second = editor();
    await openThread(seat.provider, first, 'thread-1');
    await openThread(seat.provider, second, 'thread-1');
    await seat.provider.postCompactionOffer(OFFER);

    first.close();
    await Promise.resolve();

    expect(seat.compactionOfferAbandoned).not.toHaveBeenCalled();
  });
});
