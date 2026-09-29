import type { CommandSandboxPlan, CommandSandboxReport } from '../core/command-sandbox.types';

/** A sandbox plan bound to the workspace root the command may write to. */
export interface CommandSandboxBinding {
  readonly plan: CommandSandboxPlan;
  readonly workspaceRoot: string;
}

export interface CommandLaunchInput {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly declaredEnvironment: Readonly<Record<string, string>>;
  readonly sandbox?: CommandSandboxBinding;
}

/** What to spawn, and what to report as the command that ran. */
export interface CommandLaunch {
  /** The executable the caller asked for, or the container CLI in docker mode. */
  readonly executablePath: string;
  readonly spawnPath: string;
  readonly spawnArguments: readonly string[];
  readonly sandbox?: CommandSandboxReport;
}

export type ExecutableResolver = (
  executable: string,
  environment: NodeJS.ProcessEnv,
) => Promise<string>;

/** The sandbox the command executor consults before every run. */
export interface CommandSandboxPort {
  bind(workspaceRoot: string): CommandSandboxBinding;
}

/** A background launch after the sandbox has had its say. */
export interface SandboxedBackgroundLaunch {
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly sandbox?: CommandSandboxReport;
}
