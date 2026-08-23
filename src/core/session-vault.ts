import { createHash, randomUUID } from 'node:crypto';

import { z } from 'zod';

import { normalizeBackendUrl } from './configuration';
import { FileSessionLock, type SessionLockPort } from './session-lock';

const SESSION_KEY_PREFIX = 'clawAI.session.v2.';
const LEGACY_SESSION_KEY = 'clawAI.session';
const SESSION_RECORD_VERSION = 1;

export const tokenPairSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive().optional().default(900),
    refreshExpiresIn: z.number().int().positive().optional().default(2_592_000),
    tokenType: z.literal('Bearer').optional().default('Bearer'),
  })
  .loose();

const replacementSchema = z
  .object({
    baseRevision: z.number().int().nonnegative(),
    candidateSessionId: z.uuid().optional(),
    candidateTokens: tokenPairSchema,
    committedRevision: z.number().int().positive(),
  })
  .strict();

const storedSessionSchema = z
  .object({
    /**
     * Which ClawAI account this session belongs to.
     *
     * One session is shared per backend origin across every window. Without an
     * account on the record, a window that finds a different sessionId cannot
     * tell the same user signing in again from a different account taking the
     * slot, so it assumed the worst and fell back to the Connect gate. Optional
     * because records written before this existed have no account, and those
     * keep the old strict behaviour rather than being adopted blindly.
     */
    accountId: z.string().min(1).optional(),
    replacement: replacementSchema.optional(),
    revision: z.number().int().nonnegative(),
    sessionId: z.uuid().optional(),
    tokens: tokenPairSchema.nullable(),
    version: z.literal(SESSION_RECORD_VERSION),
  })
  .strict();

export type TokenPair = z.output<typeof tokenPairSchema>;
export type TokenPairInput = z.input<typeof tokenPairSchema>;
export type RefreshSessionOutcome = 'changed' | 'missing' | 'refreshed';
export interface BoundSession {
  accountId?: string;
  sessionId: string;
  tokens: TokenPair;
}

type StoredSession = z.output<typeof storedSessionSchema>;

export interface SecretStoragePort {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

interface StoredSessionRead {
  malformed: boolean;
  record: StoredSession;
}

function sessionKey(backendUrl: string): string {
  const backend = normalizeBackendUrl(backendUrl);
  const digest = createHash('sha256').update(backend, 'utf8').digest('hex');
  return `${SESSION_KEY_PREFIX}${digest}`;
}

function emptyRecord(revision = 0): StoredSession {
  return {
    revision,
    sessionId: randomUUID(),
    tokens: null,
    version: SESSION_RECORD_VERSION,
  };
}

export class SessionVault {
  constructor(
    private readonly storage: SecretStoragePort,
    private readonly lock: SessionLockPort = new FileSessionLock(),
  ) {}

  async save(backendUrl: string, tokens: TokenPairInput): Promise<void> {
    const validated = tokenPairSchema.parse(tokens);
    const key = sessionKey(backendUrl);
    await this.mutate(key, async (current) => {
      await this.write(key, {
        revision: current.revision + 1,
        sessionId: randomUUID(),
        tokens: validated,
        version: SESSION_RECORD_VERSION,
      });
    });
  }

  async captureGeneration(backendUrl: string): Promise<number> {
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      const upgraded = await this.ensureSessionId(key, current);
      return upgraded.revision;
    });
  }

  async invalidate(backendUrl: string): Promise<void> {
    const key = sessionKey(backendUrl);
    await this.mutate(key, async (current) => {
      await this.write(key, {
        ...current,
        revision: current.revision + 1,
      });
    });
  }

  async replaceIfCurrent(
    backendUrl: string,
    tokens: TokenPairInput,
    expectedGeneration: number,
    accountId?: string,
  ): Promise<number | null> {
    const validated = tokenPairSchema.parse(tokens);
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      if (current.revision !== expectedGeneration) {
        return null;
      }
      const committedRevision = current.revision + 1;
      await this.write(key, {
        // The account that will own the session once this replacement is
        // finalized. Recorded now so a window that adopts the finalized session
        // can tell it is still the same user rather than a takeover.
        ...(accountId === undefined ? {} : { accountId }),
        replacement: {
          baseRevision: expectedGeneration,
          candidateSessionId: randomUUID(),
          candidateTokens: validated,
          committedRevision,
        },
        revision: committedRevision,
        ...(current.sessionId === undefined ? {} : { sessionId: current.sessionId }),
        tokens: current.tokens,
        version: SESSION_RECORD_VERSION,
      });
      return committedRevision;
    });
  }

  async saveIfCurrent(
    backendUrl: string,
    tokens: TokenPairInput,
    expectedGeneration: number,
  ): Promise<boolean> {
    const validated = tokenPairSchema.parse(tokens);
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      if (current.revision !== expectedGeneration) {
        return false;
      }
      await this.write(key, {
        ...(current.replacement === undefined ? {} : { replacement: current.replacement }),
        revision: current.revision + 1,
        sessionId: current.sessionId ?? randomUUID(),
        tokens: validated,
        version: SESSION_RECORD_VERSION,
      });
      return true;
    });
  }

  async refreshIfCurrent(
    backendUrl: string,
    signal: AbortSignal,
    refresh: (tokens: TokenPair) => Promise<TokenPairInput>,
    expectedSessionId?: string,
  ): Promise<RefreshSessionOutcome> {
    const key = sessionKey(backendUrl);
    await this.loadBound(backendUrl);
    const observedRevision = (await this.read(key)).record.revision;
    return this.lock.run(`${key}.refresh`, signal, async () => {
      signal.throwIfAborted();
      const current = (await this.read(key)).record;
      if (current.tokens === null) {
        return 'missing';
      }
      if (expectedSessionId !== undefined && current.sessionId !== expectedSessionId) {
        return 'changed';
      }
      if (current.revision !== observedRevision) {
        return 'changed';
      }
      const rotatedFrom = current.sessionId;
      return this.commitRotation(key, await refresh(current.tokens), rotatedFrom);
    });
  }

  /**
   * Store a pair the backend has already rotated.
   *
   * The old refresh token dies the instant the backend answers, so dropping the
   * replacement is not a safe no-op: it leaves a consumed credential in storage,
   * the next refresh replays it, the backend reads the replay as a stolen token
   * and revokes the entire family, and the panel falls back to "Connect to
   * ClawAI" — with a live agent run still in flight. This used to happen
   * whenever the record's revision moved during the round trip, or the refresh
   * was cancelled after the response arrived.
   *
   * Only two outcomes may reject the replacement, and both mean the session it
   * belongs to is gone: the record was cleared (logout), or a different account
   * session now owns the slot. Plain revision drift may not.
   */
  private async commitRotation(
    key: string,
    tokens: TokenPairInput,
    rotatedFrom: string | undefined,
  ): Promise<RefreshSessionOutcome> {
    const validated = tokenPairSchema.parse(tokens);
    return this.mutate(key, async (current) => {
      if (current.tokens === null) {
        return 'missing';
      }
      if (current.sessionId !== rotatedFrom) {
        return 'changed';
      }
      await this.write(key, {
        ...(current.replacement === undefined ? {} : { replacement: current.replacement }),
        revision: current.revision + 1,
        sessionId: current.sessionId ?? randomUUID(),
        tokens: validated,
        version: SESSION_RECORD_VERSION,
      });
      return 'refreshed';
    });
  }

  async load(backendUrl: string): Promise<TokenPair | null> {
    return (await this.loadBound(backendUrl))?.tokens ?? null;
  }

  async loadBound(backendUrl: string): Promise<BoundSession | null> {
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      const resolved = await this.ensureSessionId(key, current);
      return resolved.tokens === null
        ? null
        : {
            ...(resolved.accountId === undefined ? {} : { accountId: resolved.accountId }),
            sessionId: resolved.sessionId,
            tokens: resolved.tokens,
          };
    });
  }

  async migrateLegacy(backendUrl: string): Promise<TokenPair | null> {
    const current = await this.load(backendUrl);
    await this.storage.delete(LEGACY_SESSION_KEY);
    return current;
  }

  async clear(backendUrl: string): Promise<void> {
    const key = sessionKey(backendUrl);
    await this.mutate(key, async (current) => {
      await this.write(key, emptyRecord(current.revision + 1));
    });
  }

  async clearIfSession(backendUrl: string, expectedSessionId: string): Promise<TokenPair | null> {
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      if (current.tokens === null || current.sessionId !== expectedSessionId) {
        return null;
      }
      const tokens = current.tokens;
      await this.write(key, emptyRecord(current.revision + 1));
      return tokens;
    });
  }

  async clearLegacy(): Promise<void> {
    await this.storage.delete(LEGACY_SESSION_KEY);
  }

  async rollbackReplacement(backendUrl: string, baseGeneration: number): Promise<void> {
    const key = sessionKey(backendUrl);
    await this.mutate(key, async (current) => {
      if (current.replacement?.baseRevision !== baseGeneration) {
        return;
      }
      await this.write(key, {
        revision: current.revision + 1,
        ...(current.sessionId === undefined ? {} : { sessionId: current.sessionId }),
        tokens: current.tokens,
        version: SESSION_RECORD_VERSION,
      });
    });
  }

  async finalizeReplacement(backendUrl: string, generation: number): Promise<boolean> {
    const key = sessionKey(backendUrl);
    return this.mutate(key, async (current) => {
      if (
        current.revision !== generation ||
        current.replacement?.committedRevision !== generation
      ) {
        return false;
      }
      await this.write(key, {
        ...(current.accountId === undefined ? {} : { accountId: current.accountId }),
        revision: current.revision + 1,
        sessionId: current.replacement.candidateSessionId ?? randomUUID(),
        tokens: current.replacement.candidateTokens,
        version: SESSION_RECORD_VERSION,
      });
      return true;
    });
  }

  private async mutate<T>(
    key: string,
    action: (current: StoredSession) => Promise<T> | T,
  ): Promise<T> {
    return this.lock.run(`${key}.mutation`, undefined, async () => {
      const result = await this.read(key);
      if (result.malformed) {
        const recovered = emptyRecord(result.record.revision + 1);
        await this.write(key, recovered);
        return action(recovered);
      }
      return action(result.record);
    });
  }

  private async ensureSessionId(
    key: string,
    current: StoredSession,
  ): Promise<StoredSession & { sessionId: string }> {
    if (current.sessionId !== undefined) {
      return { ...current, sessionId: current.sessionId };
    }
    const upgraded: StoredSession & { sessionId: string } = {
      ...current,
      revision: current.revision + 1,
      sessionId: randomUUID(),
    };
    await this.write(key, upgraded);
    return upgraded;
  }

  private async read(key: string): Promise<StoredSessionRead> {
    const serialized = await this.storage.get(key);
    if (serialized === undefined) {
      return { malformed: false, record: emptyRecord() };
    }
    try {
      const value: unknown = JSON.parse(serialized);
      const stored = storedSessionSchema.safeParse(value);
      if (stored.success) {
        return { malformed: false, record: stored.data };
      }
      const legacyTokens = tokenPairSchema.safeParse(value);
      if (legacyTokens.success) {
        return {
          malformed: false,
          record: {
            revision: 0,
            tokens: legacyTokens.data,
            version: SESSION_RECORD_VERSION,
          },
        };
      }
    } catch {
      // The malformed value is replaced by a durable tombstone under the mutation lock.
    }
    return { malformed: true, record: emptyRecord() };
  }

  private async write(key: string, record: StoredSession): Promise<void> {
    await this.storage.store(key, JSON.stringify(storedSessionSchema.parse(record)));
  }
}
