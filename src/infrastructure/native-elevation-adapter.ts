import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import * as vscode from 'vscode';

import { elevationReceiptSchema, signaturesEqual } from '../core/elevation-contract';

import { resolveExecutable } from './bounded-command-runner';

import type { ElevationEnvelope, ElevationReceipt } from '../core/elevation-contract';
import type { NativeElevationPort } from '../services/elevation-broker-service';

interface PendingSignature {
  readonly key: Buffer;
  readonly expiresAt: string;
}

export class PackagedNativeElevationAdapter implements NativeElevationPort {
  readonly platform = this.platformName();
  readonly interactive = vscode.env.uiKind === vscode.UIKind.Desktop;
  private readonly pending = new Map<string, PendingSignature>();

  constructor(private readonly helperPath: string) {}

  signRequest(unsigned: Omit<ElevationEnvelope, 'signature'>): Promise<string> {
    const key = randomBytes(32);
    this.pending.set(unsigned.requestId, { key, expiresAt: unsigned.expiresAt });
    return Promise.resolve(this.sign(key, unsigned));
  }

  async execute(envelope: ElevationEnvelope, signal?: AbortSignal): Promise<unknown> {
    const pending = this.pending.get(envelope.requestId);
    if (pending?.expiresAt !== envelope.expiresAt)
      throw new Error('Elevation signing context is unavailable');
    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'clawai-elevation-'));
    const requestPath = path.join(temporaryRoot, 'request.json');
    const receiptPath = path.join(temporaryRoot, 'receipt.json');
    const keyPath = path.join(temporaryRoot, 'key.bin');
    try {
      await Promise.all([
        writeFile(requestPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 }),
        writeFile(keyPath, pending.key, { mode: 0o600 }),
      ]);
      const nodePath = await this.nodePath();
      await this.launch(
        nodePath,
        [this.helperPath, requestPath, receiptPath, keyPath],
        receiptPath,
        envelope.expiresAt,
        signal,
      );
      return JSON.parse(await readFile(receiptPath, 'utf8'));
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  verifyReceipt(receipt: ElevationReceipt): Promise<boolean> {
    const pending = this.pending.get(receipt.requestId);
    this.pending.delete(receipt.requestId);
    if (pending === undefined) return Promise.resolve(false);
    const { helperSignature, ...unsigned } = elevationReceiptSchema.parse(receipt);
    return Promise.resolve(
      signaturesEqual(Buffer.from(helperSignature), Buffer.from(this.sign(pending.key, unsigned))),
    );
  }

  async helperIdentity(): Promise<{
    readonly identity: string;
    readonly binaryHash: string;
    readonly trusted: boolean;
  }> {
    const bytes = await readFile(this.helperPath);
    const binaryHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const expected = (await readFile(`${this.helperPath}.sha256`, 'utf8')).trim().split(/\s+/u)[0];
    return {
      identity: `clawai-elevation-helper:${this.platform}`,
      binaryHash,
      trusted: expected === binaryHash.slice('sha256:'.length),
    };
  }

  private async launch(
    executable: string,
    arguments_: readonly string[],
    receiptPath: string,
    expiresAt: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (process.platform === 'win32') {
      const powershell = await this.firstExecutable(['pwsh.exe', 'powershell.exe']);
      const script = `$quoted=@($args[1..4]|ForEach-Object {'"' + ($_ -replace '"','\\"') + '"'}); $p=Start-Process -Verb RunAs -Wait -PassThru -FilePath $args[0] -ArgumentList $quoted; exit $p.ExitCode`;
      await this.spawnAndWait(
        powershell,
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script, executable, ...arguments_],
        signal,
      );
      return;
    }
    if (process.platform === 'darwin') {
      const script =
        'on run argv\nset cmd to quoted form of (item 1 of argv)\nrepeat with i from 2 to count of argv\nset cmd to cmd & " " & quoted form of (item i of argv)\nend repeat\ndo shell script cmd with administrator privileges\nend run';
      await this.spawnAndWait(
        '/usr/bin/osascript',
        ['-e', script, executable, ...arguments_],
        signal,
      );
      return;
    }
    const graphical = await this.optionalExecutable('pkexec');
    if (graphical !== undefined) {
      await this.spawnAndWait(graphical, [executable, ...arguments_], signal);
      return;
    }
    const terminalElevator = await this.firstExecutable(['sudo', 'doas']);
    const terminal = vscode.window.createTerminal({
      name: vscode.l10n.t('ClawAI administrator consent'),
      shellPath: terminalElevator,
      shellArgs: [executable, ...arguments_],
      isTransient: true,
    });
    terminal.show(true);
    try {
      await this.waitForReceipt(receiptPath, expiresAt, signal);
    } finally {
      terminal.dispose();
    }
  }

  private spawnAndWait(
    executable: string,
    arguments_: readonly string[],
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, arguments_, {
        shell: false,
        stdio: 'ignore',
        windowsHide: true,
      });
      const aborted = (): void => {
        child.kill();
      };
      child.once('error', reject);
      child.once('close', (code) => {
        signal?.removeEventListener('abort', aborted);
        if (code === 0) resolve();
        else reject(new Error(`Native elevation consent exited with ${String(code)}`));
      });
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted === true) aborted();
    });
  }

  private async waitForReceipt(
    receiptPath: string,
    expiresAt: string,
    signal?: AbortSignal,
  ): Promise<void> {
    while (Date.now() <= Date.parse(expiresAt) + 5_000) {
      signal?.throwIfAborted();
      try {
        await readFile(receiptPath);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error('Native elevation consent timed out');
  }

  private nodePath(): Promise<string> {
    return this.firstExecutable(['node', process.execPath]);
  }

  private async firstExecutable(candidates: readonly string[]): Promise<string> {
    for (const candidate of candidates) {
      const resolved = await this.optionalExecutable(candidate);
      if (resolved !== undefined) return resolved;
    }
    throw new Error(
      `Required native elevation executable is unavailable: ${candidates.join(' or ')}`,
    );
  }

  private async optionalExecutable(candidate: string): Promise<string | undefined> {
    try {
      return await resolveExecutable(candidate);
    } catch {
      return undefined;
    }
  }

  private sign(key: Buffer, value: unknown): string {
    return createHmac('sha256', key).update(JSON.stringify(value)).digest('base64url');
  }

  private platformName(): NativeElevationPort['platform'] {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'macos';
    return 'linux';
  }
}
