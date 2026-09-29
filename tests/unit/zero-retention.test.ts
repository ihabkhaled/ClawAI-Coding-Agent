import { describe, expect, it, vi } from 'vitest';

import {
  resolveZeroRetention,
  samePosture,
  zeroRetentionBlockedFeature,
  zeroRetentionHeaders,
} from '../../src/core/zero-retention';
import { ZeroRetentionPostureStore } from '../../src/core/zero-retention-posture';
import {
  retentionAwareKeyValue,
  retentionAwareTextStorage,
} from '../../src/core/zero-retention-storage';
import { ZERO_RETENTION_HEADER, ZERO_RETENTION_OFF } from '../../src/core/zero-retention.constants';

import type { KeyValueStorage, KeyedTextStorage } from '../../src/core/zero-retention.types';

function memoryText(): KeyedTextStorage & { readonly data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: async (id) => data.get(id),
    write: async (id, value) => {
      data.set(id, value);
    },
    delete: async (id) => {
      data.delete(id);
    },
    list: async () => [...data.keys()],
  };
}

function memoryKeyValue(): KeyValueStorage & { readonly data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key) => data.get(key),
    update: (key, value) => {
      data.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('resolveZeroRetention', () => {
  it('is off when neither the user nor the organization asks for it', () => {
    expect(resolveZeroRetention({ setting: false, organizationRetentionDays: undefined })).toEqual(
      ZERO_RETENTION_OFF,
    );
    expect(resolveZeroRetention({ setting: false, organizationRetentionDays: 30 }).active).toBe(
      false,
    );
  });

  it('turns on from the setting', () => {
    expect(resolveZeroRetention({ setting: true, organizationRetentionDays: 30 })).toEqual({
      active: true,
      source: 'setting',
    });
  });

  it('is forced by an organization whose retention ceiling is zero days, whatever the setting', () => {
    for (const setting of [true, false]) {
      expect(resolveZeroRetention({ setting, organizationRetentionDays: 0 })).toEqual({
        active: true,
        source: 'organization',
      });
    }
  });
});

describe('zeroRetentionBlockedFeature', () => {
  it('names the routes that exist to store content on the server', () => {
    expect(zeroRetentionBlockedFeature('POST', '/files/upload')).toBe('upload');
    expect(zeroRetentionBlockedFeature('POST', '/artifacts')).toBe('artifact-publish');
    expect(zeroRetentionBlockedFeature('POST', '/chat-threads/t-1/share')).toBe('share');
    expect(zeroRetentionBlockedFeature('POST', '/chat-threads/t-1/share/refresh')).toBe('share');
    expect(zeroRetentionBlockedFeature('PATCH', '/chat-threads/t-1/share')).toBe('share');
  });

  it('leaves reads, deletes and ordinary chat alone', () => {
    expect(zeroRetentionBlockedFeature('GET', '/files/upload')).toBeUndefined();
    expect(zeroRetentionBlockedFeature('DELETE', '/files/abc')).toBeUndefined();
    expect(zeroRetentionBlockedFeature('POST', '/chat-messages')).toBeUndefined();
    expect(zeroRetentionBlockedFeature('POST', '/files/extract-text')).toBeUndefined();
    expect(zeroRetentionBlockedFeature('POST', '/artifactsX')).toBeUndefined();
  });
});

describe('zeroRetentionHeaders', () => {
  it('carries the posture only while it is on', () => {
    expect(zeroRetentionHeaders({ active: true, source: 'setting' })).toEqual({
      [ZERO_RETENTION_HEADER]: '1',
    });
    expect(zeroRetentionHeaders(ZERO_RETENTION_OFF)).toEqual({});
  });
});

describe('ZeroRetentionPostureStore', () => {
  it('notifies on a real change only', () => {
    const store = new ZeroRetentionPostureStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set(ZERO_RETENTION_OFF);
    expect(listener).not.toHaveBeenCalled();
    store.set({ active: true, source: 'setting' });
    store.set({ active: true, source: 'setting' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.active()).toBe(true);
    store.set({ active: true, source: 'organization' });
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set(ZERO_RETENTION_OFF);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.current()).toEqual(ZERO_RETENTION_OFF);
  });

  it('compares postures by value', () => {
    expect(
      samePosture({ active: true, source: 'setting' }, { active: true, source: 'setting' }),
    ).toBe(true);
    expect(samePosture(ZERO_RETENTION_OFF, { active: true, source: 'setting' })).toBe(false);
  });
});

describe('retentionAwareTextStorage', () => {
  it('keeps writes in memory under zero retention and still reads, lists and deletes them', async () => {
    const durable = memoryText();
    await durable.write('old', 'persisted');
    let zero = true;
    const storage = retentionAwareTextStorage(durable, () => zero);

    await storage.write('run-1', 'secret');
    expect(durable.data.has('run-1')).toBe(false);
    expect(await storage.read('run-1')).toBe('secret');
    expect(await storage.read('old')).toBe('persisted');
    expect([...(await storage.list())].sort()).toEqual(['old', 'run-1']);

    await storage.delete('run-1');
    expect(await storage.read('run-1')).toBeUndefined();

    zero = false;
    await storage.write('run-2', 'kept');
    expect(durable.data.get('run-2')).toBe('kept');
  });

  it('moves a session-only entry to disk when it is written again after retention returns', async () => {
    const durable = memoryText();
    let zero = true;
    const storage = retentionAwareTextStorage(durable, () => zero);
    await storage.write('run-1', 'first');
    zero = false;
    await storage.write('run-1', 'second');
    expect(durable.data.get('run-1')).toBe('second');
    expect(await storage.read('run-1')).toBe('second');
  });
});

describe('retentionAwareKeyValue', () => {
  it('holds checkpoint updates in memory under zero retention', async () => {
    const durable = memoryKeyValue();
    await durable.update('clawAI.checkpoints', ['old']);
    let zero = true;
    const storage = retentionAwareKeyValue(durable, () => zero);

    await storage.update('clawAI.checkpoints', ['new']);
    expect(durable.data.get('clawAI.checkpoints')).toEqual(['old']);
    expect(storage.get('clawAI.checkpoints')).toEqual(['new']);

    zero = false;
    await storage.update('clawAI.checkpoints', ['kept']);
    expect(durable.data.get('clawAI.checkpoints')).toEqual(['kept']);
    expect(storage.get('clawAI.checkpoints')).toEqual(['kept']);
  });
});
