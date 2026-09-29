/** Why zero data retention is on: nobody asked, the user asked, or the organization requires it. */
export type ZeroRetentionSource = 'off' | 'setting' | 'organization';

export interface ZeroRetentionPosture {
  readonly active: boolean;
  readonly source: ZeroRetentionSource;
}

export interface ZeroRetentionInput {
  /** The `clawAI.zeroDataRetention` setting. */
  readonly setting: boolean;
  /** The organization's retention ceiling in days, when an organization imposes one. */
  readonly organizationRetentionDays: number | undefined;
}

/** A feature that only works by storing content on the server. */
export type ZeroRetentionBlockedFeature = 'upload' | 'artifact-publish' | 'share';

export type ZeroRetentionMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface ZeroRetentionBlockedRoute {
  readonly method: ZeroRetentionMethod;
  readonly pattern: RegExp;
  readonly feature: ZeroRetentionBlockedFeature;
}

export type ZeroRetentionListener = (posture: ZeroRetentionPosture) => void;

/** The shape of the run-journal store: one text blob per id. */
export interface KeyedTextStorage {
  read(id: string): Promise<string | undefined>;
  write(id: string, value: string): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<readonly string[]>;
}

/** The shape of VS Code's workspace storage as the checkpoint store uses it. */
export interface KeyValueStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}
