import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (_match, index: string) => String(args[Number(index)])),
  },
  window: { state: { focused: false } },
}));

import { ExtensionState } from '../../src/core/extension-state';
import { isSlackWebhookUrl, slackMessageBody } from '../../src/core/slack-notification';
import { SLACK_WEBHOOK_SECRET_KEY } from '../../src/core/slack-notification.constants';
import { SlackNotifier } from '../../src/services/slack-notifier';

import type { ExtensionSnapshot } from '../../src/core/extension-state';

const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/secretpart';

function snapshot(overrides: Partial<ExtensionSnapshot> = {}): ExtensionSnapshot {
  return {
    approvalRequest: undefined,
    questionRequest: undefined,
    busy: false,
    lastError: undefined,
    ...overrides,
  } as ExtensionSnapshot;
}

function secrets(value: string | undefined) {
  return {
    get: vi.fn((_key: string) => Promise.resolve(value)),
    store: vi.fn(() => Promise.resolve()),
    delete: vi.fn(() => Promise.resolve()),
  };
}

function okFetch(status = 200) {
  return vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status })));
}

function sentText(fetcher: ReturnType<typeof okFetch>, call = 0): string {
  const init = fetcher.mock.calls[call]?.[1];
  return (JSON.parse(String(init?.body)) as { text: string }).text;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('isSlackWebhookUrl', () => {
  it('accepts only an https hooks.slack.com services URL', () => {
    expect(isSlackWebhookUrl(WEBHOOK)).toBe(true);
    expect(isSlackWebhookUrl('http://hooks.slack.com/services/x')).toBe(false);
    expect(isSlackWebhookUrl('https://evil.example/services/x')).toBe(false);
    expect(isSlackWebhookUrl('https://hooks.slack.com/other/x')).toBe(false);
    expect(isSlackWebhookUrl('https://u:p@hooks.slack.com/services/x')).toBe(false);
    expect(isSlackWebhookUrl('nope')).toBe(false);
  });

  it('redacts and bounds the message body', () => {
    const body = slackMessageBody(`failed token=sk-live-123 ${'x'.repeat(600)}`);

    expect(body.text).not.toContain('sk-live-123');
    expect(body.text.length).toBeLessThanOrEqual(400);
  });
});

describe('SlackNotifier', () => {
  it('posts a completion while the window is unfocused', async () => {
    const state = new ExtensionState(snapshot({ busy: true }));
    const fetcher = okFetch();
    const store = secrets(WEBHOOK);
    new SlackNotifier(state, { secrets: store, fetcher, windowFocused: () => false });

    state.update({ busy: false });
    await flush();

    expect(store.get).toHaveBeenCalledWith(SLACK_WEBHOOK_SECRET_KEY);
    expect(fetcher.mock.calls[0]?.[0]).toBe(WEBHOOK);
    expect(sentText(fetcher)).toBe('ClawAI finished the request.');
  });

  it('posts a failure with its redacted reason only', async () => {
    const state = new ExtensionState(snapshot({ busy: true }));
    const fetcher = okFetch();
    new SlackNotifier(state, { secrets: secrets(WEBHOOK), fetcher, windowFocused: () => false });

    state.update({ busy: false, lastError: 'Upstream said Authorization: Bearer abc.def' });
    await flush();

    expect(sentText(fetcher)).toContain('The ClawAI request failed:');
    expect(sentText(fetcher)).not.toContain('abc.def');
  });

  it('stays silent while focused, for approvals, and when no webhook is set', async () => {
    const focusedState = new ExtensionState(snapshot({ busy: true }));
    const focusedFetch = okFetch();
    new SlackNotifier(focusedState, {
      secrets: secrets(WEBHOOK),
      fetcher: focusedFetch,
      windowFocused: () => true,
    });
    focusedState.update({ busy: false });

    const approvalState = new ExtensionState(snapshot());
    const approvalFetch = okFetch();
    new SlackNotifier(approvalState, {
      secrets: secrets(WEBHOOK),
      fetcher: approvalFetch,
      windowFocused: () => false,
    });
    approvalState.update({
      approvalRequest: { id: 'a1', kind: 'command', title: 'Run', message: 'npm test' },
    });

    const unsetFetch = okFetch();
    const unset = new SlackNotifier(new ExtensionState(snapshot()), {
      secrets: secrets(undefined),
      fetcher: unsetFetch,
    });
    await flush();

    expect(focusedFetch).not.toHaveBeenCalled();
    expect(approvalFetch).not.toHaveBeenCalled();
    await expect(unset.post('hi')).resolves.toBe('not-configured');
    expect(unsetFetch).not.toHaveBeenCalled();
  });

  it('reports a rejected or thrown post without ever logging the URL', async () => {
    const warn = vi.fn<(message: string) => void>();
    const rejected = new SlackNotifier(new ExtensionState(snapshot()), {
      secrets: secrets(WEBHOOK),
      fetcher: okFetch(403),
      warn,
    });
    const thrown = new SlackNotifier(new ExtensionState(snapshot()), {
      secrets: secrets(WEBHOOK),
      fetcher: vi.fn<typeof fetch>(() => Promise.reject(new TypeError(`fetch ${WEBHOOK}`))),
      warn,
    });

    await expect(rejected.post('x')).resolves.toBe('failed');
    await expect(thrown.post('x')).resolves.toBe('failed');
    for (const [message] of warn.mock.calls) expect(message).not.toContain('secretpart');
    rejected.dispose();
    thrown.dispose();
  });
});
