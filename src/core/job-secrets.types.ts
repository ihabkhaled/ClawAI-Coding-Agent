/** One secret as the backend hands it over with a claimed routine job. */
export interface JobSecretEntry {
  readonly name: string;
  readonly value: string;
}

/** Validated secrets as an environment map; empty when the job carries none. */
export type JobSecretEnvironment = Readonly<Record<string, string>>;
