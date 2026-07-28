import { z } from 'zod';

const SESSION_KEY = 'clawAI.session';
export const tokenPairSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
    expiresIn: z.number().int().positive().optional().default(900),
    refreshExpiresIn: z.number().int().positive().optional().default(2_592_000),
    tokenType: z.literal('Bearer').optional().default('Bearer'),
  })
  .loose();

export type TokenPair = z.output<typeof tokenPairSchema>;
export type TokenPairInput = z.input<typeof tokenPairSchema>;

export interface SecretStoragePort {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export class SessionVault {
  constructor(private readonly storage: SecretStoragePort) {}

  async save(tokens: TokenPairInput): Promise<void> {
    const validated = tokenPairSchema.parse(tokens);
    await this.storage.store(SESSION_KEY, JSON.stringify(validated));
  }

  async load(): Promise<TokenPair | null> {
    const serialized = await this.storage.get(SESSION_KEY);
    if (serialized === undefined) {
      return null;
    }

    try {
      return tokenPairSchema.parse(JSON.parse(serialized));
    } catch {
      await this.clear();
      return null;
    }
  }

  async clear(): Promise<void> {
    await this.storage.delete(SESSION_KEY);
  }
}
