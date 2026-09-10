import { createHash } from 'node:crypto';

import * as vscode from 'vscode';

import type { MonitorPort } from './monitor-tool-executor.types';
import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { MonitorObservation } from '../core/monitor-condition.types';

const MAX_OBSERVED_BYTES = 1_048_576;

/**
 * One look at a workspace file, through the same root resolution every other
 * tool uses so a monitor cannot watch a path the run may not read.
 *
 * The text is kept only when it is small enough to match against, and the
 * digest is taken over the bytes either way. A `changed` condition on a
 * hundred-megabyte log must not pull the log into memory to answer.
 */
export class VscodeMonitorPort implements MonitorPort {
  constructor(private readonly files: VscodeFileTransactionAdapter) {}

  async observe(path: string): Promise<MonitorObservation> {
    try {
      const uri = vscode.Uri.joinPath(this.files.workspaceRootUri('workspace-1'), path);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
      if (bytes.byteLength > MAX_OBSERVED_BYTES) {
        return { exists: true, digest };
      }
      return { exists: true, digest, text: new TextDecoder('utf-8').decode(bytes) };
    } catch {
      // Absent, unreadable, or a directory. All three are "not there yet" to a
      // run waiting for a file to appear, and none of them is worth ending a
      // wait over: the next look may find it.
      return { exists: false };
    }
  }

  async wait(delayMs: number, signal?: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, delayMs);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new Error('Monitor wait was cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  now(): number {
    return Date.now();
  }
}
