import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, platform } from 'node:process';

import { inheritedEnvironment } from '../core/inherited-environment';
import { prepareGitSpawn, prepareTrustedGitWriteSpawn } from '../infrastructure/hardened-git';

import {
  GIT_GH_CREDENTIAL_ARGUMENTS,
  GIT_KILL_GRACE_MS,
  GIT_OUTPUT_HEAD_CHARS,
  GIT_OUTPUT_TAIL_CHARS,
  GIT_QUICK_TIMEOUT_MS,
  GIT_RESULT_CEILING,
} from './git-tools.constants';

import type {
  BoundedText,
  GitInvocation,
  GitRunOptions,
  GitRunResult,
  GitToolContext,
} from './git-tools.types';

/** Keeps the first and last characters of a stream; the middle is counted, not stored. */
export function appendBounded(text: BoundedText, chunk: string): void {
  let rest = chunk;
  if (text.head.length < GIT_OUTPUT_HEAD_CHARS) {
    const room = GIT_OUTPUT_HEAD_CHARS - text.head.length;
    text.head += rest.slice(0, room);
    rest = rest.slice(room);
  }
  if (rest.length === 0) return;
  const combined = text.tail + rest;
  const overflow = Math.max(0, combined.length - GIT_OUTPUT_TAIL_CHARS);
  text.dropped += overflow;
  text.tail = combined.slice(overflow);
}

/** A bounded stream as one string, with a marker where the middle was dropped. */
export function boundedText(text: BoundedText): string {
  if (text.dropped === 0) return text.head + text.tail;
  return `${text.head}\n... ${String(text.dropped)} characters omitted ...\n${text.tail}`;
}

/** Ends a process and everything it started; a hook is a shell that starts more. */
export function killProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * Runs git with no shell, bounded output and a timeout, killing the whole
 * process tree on timeout or abort. Never rejects: a git that could not start
 * comes back as exit code -1 with the reason in stderr.
 */
export function runGitProcess(
  args: readonly string[],
  options: GitRunOptions,
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    const out: BoundedText = { head: '', tail: '', dropped: 0 };
    const err: BoundedText = { head: '', tail: '', dropped: 0 };
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const child = spawn('git', [...args], {
      cwd: options.cwd,
      env: { ...options.environment },
      shell: false,
      windowsHide: true,
      detached: platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, stdout: boundedText(out), stderr: boundedText(err), timedOut, aborted });
    };
    const stop = (): void => {
      killProcessTree(child.pid);
      timers.push(
        setTimeout(() => {
          finish(-1);
        }, GIT_KILL_GRACE_MS),
      );
    };
    function onAbort(): void {
      aborted = true;
      stop();
    }
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      appendBounded(out, chunk);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      appendBounded(err, chunk);
    });
    child.on('error', (error) => {
      appendBounded(err, error.message);
      finish(-1);
    });
    child.on('close', (code) => {
      finish(code ?? -1);
    });
    timers.push(
      setTimeout(() => {
        timedOut = true;
        stop();
      }, options.timeoutMs),
    );
    if (options.signal?.aborted === true) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Whether the GitHub CLI can be found on PATH, without running it. */
export function ghOnPath(environment: Readonly<Record<string, string | undefined>>): boolean {
  const searchPath = environment.PATH ?? environment.Path ?? '';
  const names = platform === 'win32' ? ['gh.exe', 'gh.cmd', 'gh.bat'] : ['gh'];
  return searchPath
    .split(path.delimiter)
    .filter((directory) => directory.length > 0)
    .some((directory) => names.some((name) => existsSync(path.join(directory, name))));
}

/**
 * Runs one git operation for a tool call.
 *
 * Reads go through `prepareGitSpawn` (hooks disabled, untrusted repo config
 * refused). Writes go through the trusted variant: hooks run. The caller has
 * granted `git-write` by the time this is reached, which is the trust decision
 * a headless run has to make.
 */
export function runGit(
  context: GitToolContext,
  gitArguments: readonly string[],
  invocation: GitInvocation,
): Promise<GitRunResult> {
  const base = inheritedEnvironment(env);
  const prepared = invocation.write
    ? prepareTrustedGitWriteSpawn(gitArguments, base, true)
    : prepareGitSpawn('git', gitArguments, context.workspace, base);
  const credentials =
    invocation.credentials === true && ghOnPath(base) ? GIT_GH_CREDENTIAL_ARGUMENTS : [];
  const config = (invocation.config ?? []).flatMap((pair) => ['-c', pair]);
  return runGitProcess([...credentials, ...config, ...prepared.arguments], {
    cwd: context.workspace,
    environment: { ...prepared.environment, GIT_LITERAL_PATHSPECS: '1' },
    timeoutMs: invocation.timeoutMs,
    signal: context.signal,
  });
}

/**
 * Removes colour and cursor escape sequences from tool output.
 *
 * A test runner or a hook prints them when it thinks it is on a terminal, and
 * they cost the model tokens and hide the words the line is made of.
 */
export function stripTerminalCodes(text: string): string {
  return text.replaceAll(new RegExp(String.raw`\u001B\[[0-9;?]*[ -/]*[@-~]`, 'gu'), '');
}

/** A run as the bounded JSON a tool returns, with `extra` fields beside it. */
export function outcome(
  result: GitRunResult,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const stdout = stripTerminalCodes(result.stdout);
  const stderr = stripTerminalCodes(result.stderr);
  const value: Record<string, unknown> = {
    // The envelope says a call that returned is `succeeded`; this says whether git did.
    ok: result.exitCode === 0 && !result.timedOut && !result.aborted,
    exitCode: result.exitCode,
    stdout,
    stderr,
    timedOut: result.timedOut,
    aborted: result.aborted,
    ...extra,
  };
  for (const limit of [GIT_OUTPUT_HEAD_CHARS + GIT_OUTPUT_TAIL_CHARS, 8000, 4000, 1000]) {
    if (JSON.stringify(value).length <= GIT_RESULT_CEILING) break;
    value.stdout = stdout.slice(-limit);
    value.stderr = stderr.slice(-limit);
  }
  return value;
}

/** The current branch, or undefined on a detached HEAD. */
export async function currentBranch(context: GitToolContext): Promise<string | undefined> {
  const result = await runGit(context, ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    write: false,
    timeoutMs: GIT_QUICK_TIMEOUT_MS,
  });
  const name = result.stdout.trim();
  return result.exitCode === 0 && name.length > 0 ? name : undefined;
}
