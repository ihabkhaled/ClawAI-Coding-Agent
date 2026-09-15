/** The isolation this host can actually provide for a command. */
export type SandboxKind = 'none' | 'linux-bubblewrap' | 'macos-seatbelt' | 'windows-job-object';

/**
 * What a sandbox does and does not stop.
 *
 * Every field is a claim someone will rely on, so each is stated separately
 * rather than rolled into a single "sandboxed" boolean. A jail that isolates
 * the filesystem and not the network is not the same promise as one that does
 * both, and a caller told only "yes" cannot tell which they got.
 */
export interface SandboxGuarantees {
  readonly kind: SandboxKind;
  /** The command cannot read or write outside the workspace. */
  readonly filesystemJail: boolean;
  /** The command cannot open a network connection. */
  readonly networkIsolation: boolean;
  /** The command's children are killed with it, so nothing outlives the run. */
  readonly processContainment: boolean;
  /** One sentence a person can read in a diagnostic report. */
  readonly summary: string;
}

/** What the host was found to have, before anything is chosen from it. */
export interface SandboxProbe {
  readonly platform: NodeJS.Platform;
  /** Helper executables found on PATH, by name. */
  readonly available: readonly string[];
}
