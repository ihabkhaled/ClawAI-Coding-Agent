/**
 * What the user asked for in `clawAI.commandSandbox.mode`.
 *
 * `off` runs commands bounded but unconfined, which is the default because a
 * sandbox that breaks a toolchain nobody chose to confine is worse than none.
 * `auto` takes the strongest mechanism the host has and reports `none` when it
 * has nothing. A named mechanism is a requirement: when the host cannot provide
 * it the command is refused rather than run unconfined under a false label.
 */
export type CommandSandboxMode = 'off' | 'auto' | 'bubblewrap' | 'seatbelt' | 'docker';

/** A mechanism that can actually confine a command. */
export type CommandSandboxMechanism = 'bubblewrap' | 'seatbelt' | 'docker';

/** Why a command runs without a sandbox. */
export type CommandSandboxNoneReason = 'disabled' | 'unavailable' | 'required-unavailable';

export interface CommandSandboxSettings {
  readonly mode: CommandSandboxMode;
  /** Image for the `docker` mechanism; empty means docker is not offered. */
  readonly dockerImage: string;
  /** Network stays off unless this is set, for every mechanism. */
  readonly allowNetwork: boolean;
}

/** What the host was probed to have. */
export interface CommandSandboxHost {
  readonly platform: NodeJS.Platform;
  readonly bubblewrap: boolean;
  readonly sandboxExec: boolean;
  readonly docker: boolean;
  /** Home directory, whose credential stores are hidden from the command. */
  readonly homeDirectory: string;
  /** Temporary directories the command may write to, besides the workspace. */
  readonly temporaryDirectories: readonly string[];
  /** Credential paths under home that exist, so bubblewrap can mask them. */
  readonly existingCredentialPaths: readonly CommandSandboxCredentialPath[];
}

export interface CommandSandboxCredentialPath {
  readonly path: string;
  readonly kind: 'directory' | 'file';
}

export type CommandSandboxDecision =
  | { readonly mechanism: CommandSandboxMechanism }
  | { readonly mechanism: 'none'; readonly reason: CommandSandboxNoneReason };

/**
 * What a command result says about its own confinement.
 *
 * Stated per guarantee, like `SandboxGuarantees`, because "sandboxed" alone
 * hides which half a reader is being promised.
 */
export interface CommandSandboxReport {
  readonly sandbox: CommandSandboxMechanism | 'none';
  /** `workspace` when writes outside the workspace and temp dirs are refused. */
  readonly filesystem: 'workspace' | 'unconfined';
  readonly network: 'off' | 'on';
  readonly detail: string;
}

/** The command to confine, after the host executable has been resolved. */
export interface CommandSandboxLaunch {
  /** Host path for bubblewrap and seatbelt; the bare name inside a container. */
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly workspaceRoot: string;
  /** Only the command's own declared variables cross into a container. */
  readonly declaredEnvironment: Readonly<Record<string, string>>;
}

/** What is actually spawned. */
export interface SandboxedSpawn {
  readonly executable: string;
  readonly arguments: readonly string[];
}

/** Everything the runner needs to confine one command. */
export interface CommandSandboxPlan {
  readonly settings: CommandSandboxSettings;
  readonly host: CommandSandboxHost;
  readonly decision: CommandSandboxDecision;
}
