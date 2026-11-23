import path from 'node:path';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as vscode from 'vscode';

// Containment is decided with node:path, whose separator is platform-native, so
// the registered root and the joins must agree with it on every runner.
const WORKSPACE_ROOT = path.sep === '\\' ? 'C:\\workspace' : '/workspace';

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => value),
}));

// The real wait is 3 s; the order of attempts is what is under test.
vi.mock('../../src/sdk/media-transcribe.constants', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  TRANSCRIBE_BUSY_WAIT_MS: 1,
}));

vi.mock('vscode', () => {
  const uri = (fsPath: string) => ({
    fsPath,
    path: fsPath.replaceAll('\\', '/'),
    scheme: 'file',
    toString: () => `file:///${fsPath.replaceAll('\\', '/')}`,
  });
  class FileSystemError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    FileType: { File: 1, Directory: 2 },
    FileSystemError,
    RelativePattern: class RelativePattern {
      constructor(
        readonly base: { fsPath: string },
        readonly pattern: string,
      ) {}
    },
    Uri: {
      file: uri,
      joinPath: (base: { fsPath: string }, ...parts: string[]) =>
        uri([base.fsPath, ...parts].join(path.sep)),
    },
    workspace: {
      asRelativePath: (value: { path: string }) =>
        value.path.replace(`${WORKSPACE_ROOT.replaceAll('\\', '/')}/`, ''),
      findFiles: vi.fn(async () => []),
      fs: {
        readDirectory: vi.fn(async () => []),
        readFile: vi.fn(async () => new TextEncoder().encode('')),
        stat: vi.fn(async () => ({ type: 1 })),
      },
      textDocuments: [],
      workspaceFolders: [],
    },
  };
});

import { BackendRequestError } from '../../src/backend/backend-errors';
import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';
import { VscodeFilesystemToolExecutor } from '../../src/infrastructure/vscode-filesystem-tool-executor';
import { FileTransactionService } from '../../src/services/file-transaction-service';
import { isRuntimeToolExecutionOutputValid } from '../../src/services/runtime-tool-dispatcher';

import type { PdfTextPort } from '../../src/backend/pdf-text-client';
import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';
import type { MediaTranscript } from '../../src/sdk/media-transcribe.types';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

function invocation(arguments_: RuntimeJsonObject): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'inv_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
    turnId: 'turn_01JZZZZZZZZZZZZZZZZZZZZZZ',
    toolName: 'workspace.files',
    toolVersion: '2.0.0',
    operation: 'read',
    arguments: arguments_,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idem_01JZZZZZZZZZZZZZZZZZZZZZZ',
    requestedAt: '2026-09-29T12:00:00.000Z',
  };
}

function executorWith(port?: PdfTextPort): VscodeFilesystemToolExecutor {
  const adapter = new VscodeFileTransactionAdapter();
  adapter.registerRuntimeRoot('workspace-1', WORKSPACE_ROOT);
  return new VscodeFilesystemToolExecutor(
    adapter,
    new FileTransactionService(adapter),
    { record: () => undefined },
    port,
  );
}

function transcribing(...answers: (MediaTranscript | Error)[]): {
  port: PdfTextPort;
  transcribe: Mock<NonNullable<PdfTextPort['transcribe']>>;
} {
  const transcribe = vi.fn<NonNullable<PdfTextPort['transcribe']>>();
  for (const answer of answers) {
    if (answer instanceof Error) transcribe.mockRejectedValueOnce(answer);
    else transcribe.mockResolvedValueOnce(answer);
  }
  return { port: { extract: vi.fn(), transcribe }, transcribe };
}

const spoken: MediaTranscript = {
  text: 'the meeting moved to Tuesday',
  durationSeconds: 4.2,
  provider: 'GEMINI',
  model: 'gemini-2.5-flash',
  truncated: false,
};

// The editor client folds the body's code into the message: "<reason> (<code>)".
const busy = (): BackendRequestError =>
  new BackendRequestError('Too many transcriptions right now (TRANSCRIBE_READ_BUSY)', 429, true);

/**
 * Reading audio or video in the editor.
 *
 * Until 1.113.0 only the headless tool transcribed: the editor's file tool
 * answered "no tool turns audio into text" for a WAV the backend could read,
 * so a live run in VS Code never got the words.
 */
describe('reading audio and video from the workspace in the editor', () => {
  const mediaBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0x00]);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1 } as never);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(mediaBytes);
  });

  it.each([
    ['m/memo.mp3', 'audio'],
    ['m/clip.mp4', 'video'],
  ])('returns %s as a billed %s transcript', async (file, kind) => {
    const { port, transcribe } = transcribing(spoken);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: file }),
    );

    expect(output.structured).toMatchObject({
      path: file,
      kind,
      text: 'the meeting moved to Tuesday',
      billing: `Transcribed 4 s of ${kind} (billed to your credit)`,
    });
    expect(isRuntimeToolExecutionOutputValid(output)).toBe(true);
    expect(transcribe.mock.calls[0]?.[0]).toEqual({
      fileName: file.split('/').pop(),
      contentBase64: Buffer.from(mediaBytes).toString('base64'),
    });
  });

  it('says the host cannot transcribe when it has no backend', async () => {
    await expect(
      executorWith().execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).rejects.toThrow(/audio file, and this host has no backend to transcribe it/u);
  });

  it('refuses an empty file without calling the backend', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new Uint8Array());
    const { port, transcribe } = transcribing(spoken);

    await expect(
      executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).rejects.toThrow(/empty file/u);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('waits out a busy file service, which bills nothing, then reads', async () => {
    const { port, transcribe } = transcribing(busy(), spoken);

    await expect(
      executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).resolves.toMatchObject({ structured: { text: spoken.text } });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('tells the model to try later after three busy answers', async () => {
    const { port, transcribe } = transcribing(busy(), busy(), busy());

    await expect(
      executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).rejects.toThrow(/busy.*Nothing was billed/u);
    expect(transcribe).toHaveBeenCalledTimes(3);
  });

  it('never re-sends a refusal that may follow a billed call', async () => {
    const { port, transcribe } = transcribing(
      new BackendRequestError('ClawAI request failed (503).', 503, true),
    );

    await expect(
      executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).rejects.toThrow(/HTTP 503/u);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('says nothing was billed when credit is short, and does not retry', async () => {
    const { port, transcribe } = transcribing(
      new BackendRequestError('Not enough credit (PAYG_INSUFFICIENT)', 402, false),
    );

    await expect(
      executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'memo.mp3' })),
    ).rejects.toThrow(/Not enough credit to transcribe memo.mp3\. Nothing was billed/u);
    expect(transcribe).toHaveBeenCalledTimes(1);
  });
});
