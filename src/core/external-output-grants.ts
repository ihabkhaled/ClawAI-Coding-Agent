import { z } from 'zod';

const STORAGE_KEY = 'clawAI.externalOutputGrants.v1';
const grantSchema = z
  .object({
    rootKey: z
      .string()
      .regex(/^output-[A-Za-z0-9-]+$/u)
      .max(100),
    label: z.string().trim().min(1).max(200),
    uri: z.url().startsWith('file:').max(2_000),
  })
  .strict();

export type ExternalOutputGrant = z.infer<typeof grantSchema>;

export interface WorkspaceStatePort {
  get(key: string): unknown;
  update(key: string, value: unknown): PromiseLike<void>;
}

export class ExternalOutputGrantStore {
  constructor(private readonly state: WorkspaceStatePort) {}

  snapshot(): readonly ExternalOutputGrant[] {
    const stored = this.state.get(STORAGE_KEY);
    const grants = Array.isArray(stored)
      ? stored.slice(0, 10).flatMap((entry) => {
          const parsed = grantSchema.safeParse(entry);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    return Object.freeze(grants.map((grant) => Object.freeze({ ...grant })));
  }

  resolve(rootKey: string): ExternalOutputGrant | undefined {
    return this.snapshot().find((grant) => grant.rootKey === rootKey);
  }

  async grant(grant: ExternalOutputGrant): Promise<void> {
    const validated = grantSchema.parse(grant);
    const retained = this.snapshot().filter((entry) => entry.uri !== validated.uri);
    await this.state.update(STORAGE_KEY, [...retained, validated]);
  }

  async revoke(rootKey: string): Promise<void> {
    await this.state.update(
      STORAGE_KEY,
      this.snapshot().filter((grant) => grant.rootKey !== rootKey),
    );
  }
}
