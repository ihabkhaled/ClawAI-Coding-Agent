import type { KeyValueStorage, KeyedTextStorage } from './zero-retention.types';

/**
 * A run-journal store that keeps new writes in memory while retention is off.
 *
 * Reads still see both, so a run journaled in this session can be searched and
 * resumed in this session. Nothing written under zero retention reaches disk,
 * and closing the window is the purge: the memory goes with the process.
 */
export function retentionAwareTextStorage(
  durable: KeyedTextStorage,
  zeroRetention: () => boolean,
): KeyedTextStorage {
  const session = new Map<string, string>();
  return {
    read: async (id) => session.get(id) ?? durable.read(id),
    write: async (id, value) => {
      if (zeroRetention()) {
        session.set(id, value);
        return;
      }
      session.delete(id);
      await durable.write(id, value);
    },
    delete: async (id) => {
      session.delete(id);
      await durable.delete(id);
    },
    list: async () => [...new Set([...(await durable.list()), ...session.keys()])],
  };
}

/** The same rule for key-value workspace storage, as checkpoints use it. */
export function retentionAwareKeyValue(
  durable: KeyValueStorage,
  zeroRetention: () => boolean,
): KeyValueStorage {
  const session = new Map<string, unknown>();
  return {
    get: (key) => (session.has(key) ? session.get(key) : durable.get(key)),
    update: (key, value) => {
      if (zeroRetention()) {
        session.set(key, value);
        return Promise.resolve();
      }
      session.delete(key);
      return durable.update(key, value);
    },
  };
}
