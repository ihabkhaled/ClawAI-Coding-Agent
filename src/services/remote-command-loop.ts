import path from 'node:path';

import { classifyRemoteCommand, parseRemoteCommand } from '../core/remote-command-policy';

import {
  REMOTE_COMMAND_LOOP_DEFAULTS,
  REMOTE_OUTPUT_LIMIT,
  REMOTE_REFUSED_EXIT_CODE,
} from './remote-command-loop.constants';

import type {
  RemoteCommandLoopOptions,
  RemoteCommandLoopPorts,
  RemoteLoopState,
} from './remote-command-loop.types';
import type { RemoteCommand, RemoteCommandResult } from '../backend/agent-remote-client';

/**
 * F096 remote control and F100 runner: take commands queued for this machine,
 * decide locally whether each may run, run it without a shell inside the open
 * workspace, and report the result back.
 *
 * The portal approval is necessary, never sufficient. Anything that is not an
 * allow-listed read-only command (R2 and above) waits for the person at this
 * machine; no answer is a refusal. Polling is bounded: a fixed interval while
 * healthy, exponential backoff on failure, and a stop after a run of failures.
 */
export class RemoteCommandLoop {
  private controller: AbortController | null = null;
  private currentState: RemoteLoopState = 'idle';

  constructor(
    private readonly ports: RemoteCommandLoopPorts,
    private readonly options: RemoteCommandLoopOptions = REMOTE_COMMAND_LOOP_DEFAULTS,
  ) {}

  get state(): RemoteLoopState {
    return this.currentState;
  }

  /** Starts polling; the returned promise settles when the loop ends. */
  start(): Promise<void> {
    if (this.controller !== null) {
      return Promise.resolve();
    }
    const controller = new AbortController();
    this.controller = controller;
    return this.run(controller.signal).finally(() => {
      if (this.controller === controller) this.controller = null;
    });
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    this.setState('stopped');
  }

  private async run(signal: AbortSignal): Promise<void> {
    this.setState('running');
    let failures = 0;
    let polls = 0;
    while (!signal.aborted) {
      try {
        if (polls % this.options.heartbeatEveryPolls === 0) {
          await this.ports.source.heartbeat();
        }
        polls += 1;
        const commands = await this.ports.source.fetch(signal);
        failures = 0;
        for (const command of commands) {
          if (isAborted(signal)) break;
          await this.handle(command, signal);
        }
        await this.ports.sleep(this.options.pollIntervalMs, signal);
      } catch (error: unknown) {
        if (isAborted(signal)) break;
        failures += 1;
        if (failures >= this.options.maxConsecutiveFailures) {
          this.ports.report(
            `Remote commands stopped after ${String(failures)} failures: ${message(error)}`,
          );
          this.setState('failed');
          return;
        }
        await this.ports.sleep(this.backoff(failures), signal);
      }
    }
  }

  private backoff(failures: number): number {
    return Math.min(this.options.pollIntervalMs * 2 ** failures, this.options.maxBackoffMs);
  }

  private async handle(command: RemoteCommand, signal: AbortSignal): Promise<void> {
    let result: RemoteCommandResult;
    try {
      result = await this.decide(command, signal);
    } catch (error: unknown) {
      result = { exitCode: 1, stdout: '', stderr: bounded(message(error)) };
    }
    await this.ports.source.complete(command.id, result);
    this.ports.report(
      `Remote command ${command.id} finished with exit code ${String(result.exitCode)}.`,
    );
  }

  private async decide(command: RemoteCommand, signal: AbortSignal): Promise<RemoteCommandResult> {
    if (command.kind === 'PROMPT') {
      return this.runPrompt(command, signal);
    }
    const parsed = parseRemoteCommand(command.command);
    if (parsed.kind === 'refused') {
      return refused(parsed.reason);
    }
    const cwd = this.resolveWorkingDir(command.workingDir ?? undefined);
    if (cwd === undefined) {
      return refused('The working directory is not inside the open workspace.');
    }
    const risk = classifyRemoteCommand(parsed.executable, parsed.args);
    if (risk !== 'R1') {
      const approved = await this.ports.approve({
        command: command.command,
        risk,
        workingDir: cwd,
      });
      if (!approved) {
        return refused('Declined on this machine.');
      }
    }
    const execution = await this.ports.execute(parsed.executable, parsed.args, cwd, signal);
    return {
      exitCode: execution.exitCode ?? 1,
      stdout: bounded(execution.stdout),
      stderr: bounded(execution.stderr),
    };
  }

  /** Prompt jobs run only where a runner wired a prompt executor. */
  private async runPrompt(
    command: RemoteCommand,
    signal: AbortSignal,
  ): Promise<RemoteCommandResult> {
    if (this.ports.runPrompt === undefined) {
      return refused('This machine does not run prompt jobs.');
    }
    const result = await this.ports.runPrompt(
      {
        id: command.id,
        prompt: command.command,
        model: command.model ?? undefined,
        repoRef: command.repoRef ?? undefined,
      },
      signal,
    );
    return {
      exitCode: result.exitCode,
      stdout: bounded(result.stdout),
      stderr: bounded(result.stderr),
    };
  }

  private resolveWorkingDir(requested: string | undefined): string | undefined {
    const root = this.ports.workspaceRoot();
    if (root === undefined) return undefined;
    if (requested === undefined || requested.length === 0) return root;
    const resolved = path.resolve(root, requested);
    const relative = path.relative(root, resolved);
    const inside = !relative.startsWith('..') && !path.isAbsolute(relative);
    return inside ? resolved : undefined;
  }

  private setState(state: RemoteLoopState): void {
    this.currentState = state;
    this.ports.stateChanged?.(state);
  }
}

/** Read through a call: an await may abort the signal, which narrowing cannot see. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function refused(reason: string): RemoteCommandResult {
  return { exitCode: REMOTE_REFUSED_EXIT_CODE, stdout: '', stderr: reason };
}

function bounded(text: string): string {
  return text.length <= REMOTE_OUTPUT_LIMIT ? text : text.slice(text.length - REMOTE_OUTPUT_LIMIT);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.';
}
