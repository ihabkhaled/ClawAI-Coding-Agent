import { randomUUID } from 'node:crypto';

import { z } from 'zod';

const STORAGE_KEY = 'clawAI.databaseProfiles.v1';
const profileMetadataSchema = z
  .object({
    profileId: z.string().min(8).max(200),
    label: z.string().min(1).max(200),
    engine: z.enum([
      'postgresql',
      'mysql',
      'mariadb',
      'mongodb',
      'sqlite',
      'redis',
      'sqlserver',
      'cockroachdb',
      'oracle',
      'elasticsearch',
      'opensearch',
      'neo4j',
    ]),
    environment: z.enum(['local', 'development', 'test', 'staging', 'production']),
    hostLabel: z.string().min(1).max(200),
    databaseLabel: z.string().min(1).max(200),
  })
  .strict();
const secretSchema = z.object({ connection: z.string().min(1).max(16_384) }).strict();

export type DatabaseProfileMetadata = z.infer<typeof profileMetadataSchema>;

interface SecretStoragePort {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

interface MementoPort {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

export class DatabaseProfileVault {
  constructor(
    private readonly secrets: SecretStoragePort,
    private readonly state: MementoPort,
  ) {}

  list(): readonly DatabaseProfileMetadata[] {
    const value = this.state.get(STORAGE_KEY);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      const parsed = profileMetadataSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async save(
    metadata: Omit<DatabaseProfileMetadata, 'profileId'> & { profileId?: string },
    connection: string,
  ): Promise<DatabaseProfileMetadata> {
    const profile = profileMetadataSchema.parse({
      ...metadata,
      profileId: metadata.profileId ?? `database:${randomUUID()}`,
    });
    await this.secrets.store(
      this.secretKey(profile.profileId),
      JSON.stringify(secretSchema.parse({ connection })),
    );
    await this.state.update(STORAGE_KEY, [
      ...this.list().filter((item) => item.profileId !== profile.profileId),
      profile,
    ]);
    return profile;
  }

  async resolve(profileId: string): Promise<string> {
    const stored = await this.secrets.get(this.secretKey(profileId));
    if (stored === undefined) throw new Error('Database credentials are unavailable');
    const candidate: unknown = JSON.parse(stored);
    return secretSchema.parse(candidate).connection;
  }

  async remove(profileId: string): Promise<void> {
    await this.secrets.delete(this.secretKey(profileId));
    await this.state.update(
      STORAGE_KEY,
      this.list().filter((item) => item.profileId !== profileId),
    );
  }

  private secretKey(profileId: string): string {
    return `clawAI.databaseProfileSecret.${profileId}`;
  }
}
