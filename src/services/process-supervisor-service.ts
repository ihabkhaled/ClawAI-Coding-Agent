import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import * as vscode from 'vscode';
import { z } from 'zod';

import { redactText } from '../core/redaction';

import type * as Pty from 'node-pty';

async function loadPty(): Promise<typeof Pty> {
  if (process.platform !== 'linux') return import('node-pty');
  const linuxPty = await import('@homebridge/node-pty-prebuilt-multiarch');
  return linuxPty;
}

const processStartSchema = z
  .object({
    ownerId: z.string().min(1).max(200),
    runId: z.string().min(8).max(200),
    targetId: z.string().min(8).max(200),
    executablePath: z.string().min(1).max(4_096),
    arguments: z.array(z.string().max(32_768)).max(1_000),
    cwd: z.string().min(1).max(4_096),
    environment: z
      .record(
        z
          .string()
          .regex(/^(?!.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH))[A-Z_][A-Z0-9_]{0,99}$/iu),
        z.string().max(32_768),
      )
      .default({}),
    columns: z.number().int().min(20).max(500).default(120),
    rows: z.number().int().min(5).max(200).default(30),
    title: z.string().min(1).max(200),
    readinessPattern: z.string().max(1_000).optional(),
    expectedPorts: z.array(z.number().int().min(1).max(65_535)).max(100).default([]),
  })
  .strict();

export type ProcessStart = z.infer<typeof processStartSchema>;

export interface ProcessIdentityReceipt {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly runId: string;
  readonly targetId: string;
  readonly pid: number;
  readonly executableHash: string;
  readonly startedAt: string;
}

export interface SupervisedProcessSnapshot extends ProcessIdentityReceipt {
  readonly lifecycle: 'running' | 'paused' | 'exited' | 'disposed';
  readonly exitCode: number | null;
  readonly signal: number | null;
  readonly log: string;
  readonly logTruncated: boolean;
  readonly ready: boolean;
  readonly expectedPorts: readonly number[];
  readonly terminalAttached: boolean;
}

interface SupervisedSession {
  readonly receipt: ProcessIdentityReceipt;
  readonly process: Pty.IPty;
  readonly exit: Promise<void>;
  readonly output: vscode.EventEmitter<string>;
  readonly expectedPorts: readonly number[];
  terminal: vscode.Terminal | undefined;
  lifecycle: SupervisedProcessSnapshot['lifecycle'];
  exitCode: number | null;
  signal: number | null;
  log: string;
  logTruncated: boolean;
  ready: boolean;
}

const MAX_RETAINED_LOG_BYTES = 1_048_576;

export class ProcessSupervisorService implements vscode.Disposable {
  private readonly sessions = new Map<string, SupervisedSession>();

  async create(candidate: unknown): Promise<ProcessIdentityReceipt> {
    const input = processStartSchema.parse(candidate);
    const executableHash = `sha256:${createHash('sha256')
      .update(await readFile(input.executablePath))
      .digest('hex')}`;
    const sessionId = `process:${randomUUID()}`;
    const pty = await loadPty();
    const process = pty.spawn(input.executablePath, input.arguments, {
      name: 'xterm-256color',
      cols: input.columns,
      rows: input.rows,
      cwd: input.cwd,
      env: input.environment,
      useConpty: processPlatformSupportsConpty(),
    });
    const receipt: ProcessIdentityReceipt = {
      sessionId,
      ownerId: input.ownerId,
      runId: input.runId,
      targetId: input.targetId,
      pid: process.pid,
      executableHash,
      startedAt: new Date().toISOString(),
    };
    const output = new vscode.EventEmitter<string>();
    let settleExit: (() => void) | undefined;
    const exit = new Promise<void>((resolve) => {
      settleExit = resolve;
    });
    const session: SupervisedSession = {
      receipt,
      process,
      exit,
      output,
      expectedPorts: input.expectedPorts,
      terminal: undefined,
      lifecycle: 'running',
      exitCode: null,
      signal: null,
      log: '',
      logTruncated: false,
      ready: false,
    };
    const readiness = input.readinessPattern;
    process.onData((data: string) => {
      const redacted = redactText(data);
      output.fire(redacted);
      const combined = `${session.log}${redacted}`;
      if (Buffer.byteLength(combined, 'utf8') > MAX_RETAINED_LOG_BYTES) {
        session.log = combined.slice(-MAX_RETAINED_LOG_BYTES);
        session.logTruncated = true;
      } else session.log = combined;
      session.ready ||= readiness === undefined ? false : redacted.includes(readiness);
    });
    process.onExit(({ exitCode, signal }) => {
      session.lifecycle = 'exited';
      session.exitCode = exitCode;
      session.signal = signal ?? null;
      settleExit?.();
    });
    this.sessions.set(sessionId, session);
    this.attachTerminal(session, input.title);
    return receipt;
  }

  write(receipt: ProcessIdentityReceipt, data: string): void {
    this.owned(receipt).process.write(data.slice(0, 65_536));
  }

  resize(receipt: ProcessIdentityReceipt, columns: number, rows: number): void {
    if (!Number.isInteger(columns) || !Number.isInteger(rows))
      throw new Error('PTY size is invalid');
    this.owned(receipt).process.resize(
      Math.max(20, Math.min(columns, 500)),
      Math.max(5, Math.min(rows, 200)),
    );
  }

  snapshot(receipt: ProcessIdentityReceipt): SupervisedProcessSnapshot {
    const session = this.owned(receipt);
    return {
      ...session.receipt,
      lifecycle: session.lifecycle,
      exitCode: session.exitCode,
      signal: session.signal,
      log: session.log,
      logTruncated: session.logTruncated,
      ready: session.ready,
      expectedPorts: session.expectedPorts,
      terminalAttached: session.terminal !== undefined,
    };
  }

  readinessEvidence(
    sessionId: string,
    runId: string,
  ): { readonly running: boolean; readonly logs: string } {
    const session = this.sessions.get(sessionId);
    if (session?.receipt.runId !== runId)
      throw new Error('Process readiness evidence is stale or not owned by this run');
    return {
      running: session.lifecycle === 'running' || session.lifecycle === 'paused',
      logs: session.log,
    };
  }

  interrupt(receipt: ProcessIdentityReceipt): void {
    this.owned(receipt).process.kill('SIGINT');
  }

  async terminate(receipt: ProcessIdentityReceipt, graceMs = 2_000): Promise<void> {
    const session = this.owned(receipt);
    if (session.lifecycle === 'exited' || session.lifecycle === 'disposed') return;
    session.process.kill('SIGTERM');
    const timer = new Promise<'timeout'>((resolve) =>
      setTimeout(() => {
        resolve('timeout');
      }, graceMs),
    );
    if ((await Promise.race([session.exit.then(() => 'exit' as const), timer])) === 'timeout')
      session.process.kill('SIGKILL');
  }

  pause(receipt: ProcessIdentityReceipt): void {
    if (process.platform === 'win32') throw new Error('Process pause is unavailable on Windows');
    const session = this.owned(receipt);
    session.process.kill('SIGSTOP');
    session.lifecycle = 'paused';
  }

  resume(receipt: ProcessIdentityReceipt): void {
    if (process.platform === 'win32') throw new Error('Process resume is unavailable on Windows');
    const session = this.owned(receipt);
    session.process.kill('SIGCONT');
    session.lifecycle = 'running';
  }

  async join(
    receipts: readonly ProcessIdentityReceipt[],
  ): Promise<readonly SupervisedProcessSnapshot[]> {
    const sessions = receipts.map((receipt) => this.owned(receipt));
    await Promise.all(sessions.map((session) => session.exit));
    return receipts.map((receipt) => this.snapshot(receipt));
  }

  async race(receipts: readonly ProcessIdentityReceipt[]): Promise<SupervisedProcessSnapshot> {
    const sessions = receipts.map((receipt) => this.owned(receipt));
    const winner = await Promise.race(sessions.map((session) => session.exit.then(() => session)));
    return this.snapshot(winner.receipt);
  }

  async disposeSession(receipt: ProcessIdentityReceipt): Promise<void> {
    const session = this.owned(receipt);
    await this.terminate(receipt);
    session.terminal?.dispose();
    session.output.dispose();
    session.lifecycle = 'disposed';
    this.sessions.delete(receipt.sessionId);
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.process.kill();
      session.terminal?.dispose();
      session.output.dispose();
    }
    this.sessions.clear();
  }

  private attachTerminal(session: SupervisedSession, title: string): void {
    const terminal = vscode.window.createTerminal({
      name: title,
      pty: {
        onDidWrite: session.output.event,
        open: () => undefined,
        close: () => {
          session.terminal = undefined;
        },
        handleInput: (data: string) => {
          session.process.write(data);
        },
        setDimensions: (dimensions: vscode.TerminalDimensions) => {
          session.process.resize(dimensions.columns, dimensions.rows);
        },
      },
    });
    session.terminal = terminal;
    terminal.show(true);
  }

  private owned(receipt: ProcessIdentityReceipt): SupervisedSession {
    const session = this.sessions.get(receipt.sessionId);
    if (
      session?.receipt.pid !== receipt.pid ||
      session.receipt.startedAt !== receipt.startedAt ||
      session.receipt.ownerId !== receipt.ownerId ||
      session.receipt.runId !== receipt.runId ||
      session.receipt.targetId !== receipt.targetId ||
      session.receipt.executableHash !== receipt.executableHash
    )
      throw new Error('Process identity receipt is stale or not owned by this runtime');
    return session;
  }
}

const processPlatformSupportsConpty = (): boolean => process.platform === 'win32';
