import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { durableRunJournalSchema, type DurableRunJournal } from '../core/durable-run-journal';
import { redactText } from '../core/redaction';

export interface RunJournalStoragePort {
  read(runId: string): Promise<string | undefined>;
  write(runId: string, encrypted: string): Promise<void>;
  delete(runId: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

export interface RunJournalKeyPort {
  get(): Promise<Uint8Array | undefined>;
  set(value: Uint8Array): Promise<void>;
}

interface EncryptedJournal {
  readonly version: 1;
  readonly iv: string;
  readonly tag: string;
  readonly ciphertext: string;
}

const encryptedJournalSchema = z
  .object({
    version: z.literal(1),
    iv: z.string().min(16).max(64),
    tag: z.string().min(16).max(64),
    ciphertext: z.string().min(1).max(134_217_728),
  })
  .strict();

export class RunJournalService {
  constructor(
    private readonly storage: RunJournalStoragePort,
    private readonly keys: RunJournalKeyPort,
  ) {}

  async save(candidate: unknown): Promise<void> {
    const journal = durableRunJournalSchema.parse(candidate);
    const key = await this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(journal), 'utf8'),
      cipher.final(),
    ]);
    const encrypted: EncryptedJournal = {
      version: 1,
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
    await this.storage.write(journal.runId, JSON.stringify(encrypted));
  }

  async load(runId: string): Promise<DurableRunJournal | undefined> {
    const encoded = await this.storage.read(runId);
    if (encoded === undefined) return undefined;
    const encrypted = encryptedJournalSchema.parse(JSON.parse(encoded));
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        await this.key(),
        Buffer.from(encrypted.iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64url'));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return durableRunJournalSchema.parse(JSON.parse(plain));
    } catch {
      throw new Error('Run journal is corrupt or belongs to another secure storage identity');
    }
  }

  async delete(runId: string): Promise<void> {
    await this.storage.delete(runId);
  }

  async list(): Promise<readonly DurableRunJournal[]> {
    const journals: DurableRunJournal[] = [];
    for (const runId of await this.storage.list()) {
      const journal = await this.load(runId);
      if (journal !== undefined) journals.push(journal);
    }
    return journals.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async search(
    query: string,
  ): Promise<
    readonly Pick<
      DurableRunJournal,
      'runId' | 'goal' | 'labels' | 'pinned' | 'lifecycle' | 'updatedAt'
    >[]
  > {
    const normalized = query.trim().toLocaleLowerCase();
    const matches: Pick<
      DurableRunJournal,
      'runId' | 'goal' | 'labels' | 'pinned' | 'lifecycle' | 'updatedAt'
    >[] = [];
    for (const runId of await this.storage.list()) {
      const journal = await this.load(runId);
      if (journal === undefined) continue;
      if (`${journal.goal} ${journal.labels.join(' ')}`.toLocaleLowerCase().includes(normalized)) {
        matches.push({
          runId,
          goal: redactText(journal.goal),
          labels: journal.labels,
          pinned: journal.pinned,
          lifecycle: journal.lifecycle,
          updatedAt: journal.updatedAt,
        });
      }
    }
    return matches.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt),
    );
  }

  async safeExport(runId: string): Promise<Readonly<Record<string, unknown>>> {
    const journal = await this.load(runId);
    if (journal === undefined) throw new Error('Run journal is unavailable');
    return {
      schemaVersion: journal.schemaVersion,
      runId: journal.runId,
      lifecycle: journal.lifecycle,
      goal: redactText(journal.goal),
      labels: journal.labels,
      compactedContext:
        journal.compactedContext === undefined
          ? undefined
          : {
              ...journal.compactedContext,
              summary: redactText(journal.compactedContext.summary),
            },
      evidenceReferences: journal.evidenceReferences,
      updatedAt: journal.updatedAt,
    };
  }

  private async key(): Promise<Uint8Array> {
    const existing = await this.keys.get();
    if (existing !== undefined) {
      if (existing.byteLength !== 32) throw new Error('Run journal encryption key is invalid');
      return existing;
    }
    const created = randomBytes(32);
    await this.keys.set(created);
    return created;
  }
}
