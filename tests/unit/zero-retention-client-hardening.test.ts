import { beforeEach, describe, expect, it, vi } from 'vitest';

const warnings: string[] = [];

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
  window: {
    showWarningMessage: vi.fn(async (message: string) => {
      warnings.push(message);
    }),
  },
}));

import {
  ZeroRetentionRefusedError,
  retentionRequestHeaders,
} from '../../src/backend/zero-retention-guard';
import { threadTitleFor } from '../../src/core/zero-retention';
import { zeroRetentionPosture } from '../../src/core/zero-retention-posture';
import { retentionAwareKeyValue } from '../../src/core/zero-retention-storage';
import {
  ZERO_RETENTION_OFF,
  ZERO_RETENTION_THREAD_TITLE,
} from '../../src/core/zero-retention.constants';
import { ChatService, type ChatBackendPort } from '../../src/services/chat-service';
import { zeroRetentionUsageLines } from '../../src/services/show-usage-retention';
import {
  refuseCompareCommand,
  refuseCompareUnderZeroRetention,
} from '../../src/services/zero-retention-compare-guard';

import type { ZeroRetentionPosture } from '../../src/core/zero-retention.types';

const ON: ZeroRetentionPosture = { active: true, source: 'setting' };
const on = { active: () => true };
const off = { active: () => false };

beforeEach(() => {
  warnings.length = 0;
});

describe('zero retention: compare / parallel', () => {
  it('refuses the compare command with the translated message and sends nothing', async () => {
    await expect(refuseCompareCommand(on)).resolves.toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('models are not compared');
  });

  it('refuses the webview compare path by throwing', () => {
    expect(() => {
      refuseCompareUnderZeroRetention(on);
    }).toThrow('models are not compared');
  });

  it('refuses the parallel route before any request is built', () => {
    expect(() => retentionRequestHeaders('POST', '/chat-messages/parallel', ON)).toThrow(
      ZeroRetentionRefusedError,
    );
  });

  it('changes nothing when retention is off', async () => {
    await expect(refuseCompareCommand(off)).resolves.toBe(false);
    expect(warnings).toHaveLength(0);
    expect(() => {
      refuseCompareUnderZeroRetention(off);
    }).not.toThrow();
    expect(retentionRequestHeaders('POST', '/chat-messages/parallel', ZERO_RETENTION_OFF)).toEqual(
      {},
    );
    expect(retentionRequestHeaders('POST', '/chat-messages', ON)).toEqual({
      'X-Claw-Zero-Retention': '1',
    });
  });
});

describe('zero retention: auto-derived thread title', () => {
  it('never puts the prompt in the title while on', () => {
    expect(threadTitleFor('my secret plan', ON)).toBe(ZERO_RETENTION_THREAD_TITLE);
  });

  it('keeps deriving the title from the prompt when off', () => {
    expect(threadTitleFor('  fix the login bug  ', ZERO_RETENTION_OFF)).toBe('fix the login bug');
    expect(threadTitleFor('x'.repeat(200), ZERO_RETENTION_OFF)).toHaveLength(80);
  });
});

describe('zero retention: transcript never reaches workspace state', () => {
  function memento(): {
    store: Map<string, unknown>;
    storage: Parameters<typeof retentionAwareKeyValue>[0];
  } {
    const store = new Map<string, unknown>();
    return {
      store,
      storage: {
        get: (key) => store.get(key),
        update: (key, value) => {
          store.set(key, value);
          return Promise.resolve();
        },
      },
    };
  }

  it('keeps the transcript in memory only while on', async () => {
    const { store, storage } = memento();
    const guarded = retentionAwareKeyValue(storage, () => true);
    await guarded.update('transcript', ['secret']);
    expect(guarded.get('transcript')).toEqual(['secret']);
    expect(store.size).toBe(0);
  });

  it('writes through when off', async () => {
    const { store, storage } = memento();
    await retentionAwareKeyValue(storage, () => false).update('transcript', ['x']);
    expect(store.get('transcript')).toEqual(['x']);
  });
});

describe('zero retention: Show Usage', () => {
  it('states the on state and who turned it on', () => {
    expect(zeroRetentionUsageLines(ON).join('\n')).toContain('On, turned on by your setting.');
    expect(zeroRetentionUsageLines({ active: true, source: 'organization' }).join('\n')).toContain(
      'required by your organization',
    );
  });

  it('states the off state', () => {
    expect(zeroRetentionUsageLines(ZERO_RETENTION_OFF).join('\n')).toContain('Off.');
  });
});

describe('zero retention: ChatService thread creation', () => {
  async function createdTitle(): Promise<string | undefined> {
    const createThread = vi.fn(async (_input: { title?: string }) => ({ id: 't1' }));
    const backend: ChatBackendPort = {
      createThread,
      openStream: vi.fn(async () => new Response('data: {"type":"done"}\n\n')),
      sendMessage: vi.fn(async () => ({ id: 'm1' })),
    };
    await new ChatService(backend).send(
      { content: 'my secret plan', context: [], routingMode: 'AUTO' },
      () => undefined,
    );
    return createThread.mock.calls[0]?.[0].title;
  }

  it('sends a neutral title while on and the prompt opening when off', async () => {
    zeroRetentionPosture.set(ON);
    expect(await createdTitle()).toBe(ZERO_RETENTION_THREAD_TITLE);
    zeroRetentionPosture.set(ZERO_RETENTION_OFF);
    expect(await createdTitle()).toBe('my secret plan');
  });
});
