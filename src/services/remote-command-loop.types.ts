import type { RemoteCommand, RemoteCommandResult } from '../backend/agent-remote-client';
import type { RemoteCommandRisk } from '../core/remote-command-policy.types';

export type RemoteLoopState = 'idle' | 'running' | 'stopped' | 'failed';

/** Where commands come from: the remote-control queue or the runner queue. */
export interface RemoteCommandSource {
  fetch(signal: AbortSignal): Promise<RemoteCommand[]>;
  heartbeat(): Promise<void>;
  complete(commandId: string, result: RemoteCommandResult): Promise<void>;
}

export interface RemoteCommandApproval {
  readonly command: string;
  readonly risk: RemoteCommandRisk;
  readonly workingDir: string;
}

export interface RemoteExecution {
  readonly exitCode: number | undefined;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RemoteCommandLoopPorts {
  readonly source: RemoteCommandSource;
  /** Resolves false when the person declines or does not answer in time. */
  approve(request: RemoteCommandApproval): Promise<boolean>;
  execute(
    executable: string,
    args: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<RemoteExecution>;
  /** The workspace root commands run in; undefined when no folder is open. */
  workspaceRoot(): string | undefined;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  report(message: string): void;
  stateChanged?(state: RemoteLoopState): void;
}

export interface RemoteCommandLoopOptions {
  readonly pollIntervalMs: number;
  readonly maxBackoffMs: number;
  readonly maxConsecutiveFailures: number;
  readonly heartbeatEveryPolls: number;
}
