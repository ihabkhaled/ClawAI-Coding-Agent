import path from 'node:path';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import * as vscode from 'vscode';

// Containment is decided with node:path, whose separator is platform-native, so
// the registered root and the joins must agree with it on every runner.
const WORKSPACE_ROOT = path.sep === '\\' ? 'C:\\workspace' : '/workspace';

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => value),
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

import { VscodeFileTransactionAdapter } from '../../src/infrastructure/vscode-file-transaction-adapter';
import { VscodeFilesystemToolExecutor } from '../../src/infrastructure/vscode-filesystem-tool-executor';
import { FileTransactionService } from '../../src/services/file-transaction-service';
import { isRuntimeToolExecutionOutputValid } from '../../src/services/runtime-tool-dispatcher';

import type { PdfTextPort } from '../../src/backend/pdf-text-client';
import type {
  RuntimeJsonObject,
  ToolInvocation,
} from '../../src/core/runtime/runtime-tool-contracts';
import type { RuntimeToolExecutionOutput } from '../../src/services/runtime-tool-dispatcher';

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

interface Page {
  number: number;
  text: string;
}

const page = (number: number, text = `page ${String(number)}`): Page => ({ number, text });

function portAnswering(
  pages: Page[],
  totalPages: number,
  isScanned = false,
): { extract: Mock<PdfTextPort['extract']> } {
  return {
    extract: vi.fn<PdfTextPort['extract']>(async () => ({
      text: pages.map((entry) => entry.text).join('\n'),
      pages: pages.map((entry) => ({ number: entry.number, text: entry.text })),
      totalPages,
      isScanned,
    })),
  };
}

function deliveredPages(output: RuntimeToolExecutionOutput): Page[] {
  const pages = output.structured?.pages;
  return Array.isArray(pages) ? (pages as Page[]) : [];
}

/**
 * Reading a PDF that is already in the workspace.
 *
 * It used to fail as "not UTF-8 text and cannot be read", which is true and
 * useless: the agent could see a spec, a contract or a datasheet sitting in the
 * repository and do nothing with it. The bytes now go to the backend's
 * extractor, which stores nothing — a read, not an upload.
 */
describe('reading a PDF from the workspace', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0xff]);

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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({ type: 1 } as never);
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(pdfBytes);
  });

  it('reads the first page window when no range is given', async () => {
    const port = portAnswering([page(1), page(2)], 2);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'docs/spec.pdf' }),
    );

    expect(port.extract.mock.calls[0]?.[0]).toMatchObject({
      filename: 'spec.pdf',
      pages: { from: 1, to: 20 },
    });
    expect(output.structured).toMatchObject({ format: 'pdf', totalPages: 2 });
    expect(isRuntimeToolExecutionOutputValid(output)).toBe(true);
  });

  it('sends the file bytes, not a path', async () => {
    const port = portAnswering([page(1)], 1);

    await executorWith(port).execute(invocation({ rootKey: 'workspace-1', path: 'a.pdf' }));

    // The backend cannot see the workspace. What it parses is what was read.
    expect(port.extract.mock.calls[0]?.[0].contentBase64).toBe(
      Buffer.from(pdfBytes).toString('base64'),
    );
  });

  it('passes a requested range straight through', async () => {
    const port = portAnswering([page(40), page(41)], 90);

    await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf', pages: { from: 40, to: 41 } }),
    );

    expect(port.extract.mock.calls[0]?.[0].pages).toEqual({ from: 40, to: 41 });
  });

  it('says where the document continues, and how to ask for it', async () => {
    // The tool description has no room left for a `pages` argument, so this
    // result is the only place a model learns it exists.
    const port = portAnswering([page(1), page(2), page(3)], 90);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf', pages: { from: 1, to: 3 } }),
    );

    expect(output.structured).toMatchObject({ nextPage: 4 });
    expect(String(output.structured?.hint)).toContain('"from":4');
  });

  it('does not call a complete read of a partial range truncated', async () => {
    // Pages 1-3 of 90, all delivered: the request was met in full. The
    // document going on is a different fact, carried by nextPage.
    const port = portAnswering([page(1), page(2), page(3)], 90);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf', pages: { from: 1, to: 3 } }),
    );

    expect(output.structured).toMatchObject({ truncated: false, nextPage: 4 });
  });

  it('stops on a page boundary when the byte budget runs out', async () => {
    const big = 'x'.repeat(40_000);
    const port = portAnswering([page(1, big), page(2, big), page(3, big)], 3);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf', pages: { from: 1, to: 3 } }),
    );

    // Two 40kB pages exceed the 64kB budget, so only the first is delivered —
    // whole, never cut mid-way — and the read resumes at page 2.
    expect(output.structured).toMatchObject({ truncated: true, nextPage: 2 });
    expect(deliveredPages(output)).toHaveLength(1);
    expect(isRuntimeToolExecutionOutputValid(output)).toBe(true);
  });

  it('cuts a single page larger than the whole budget rather than skipping it', async () => {
    // Skipping it would hand back nextPage pointing at the same page, forever.
    const port = portAnswering([page(1, 'y'.repeat(200_000))], 1);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf' }),
    );

    expect(isRuntimeToolExecutionOutputValid(output)).toBe(true);
    expect(deliveredPages(output)[0]?.text.length).toBeLessThanOrEqual(65_536);
  });

  it('reports a scanned document instead of calling it empty', async () => {
    const port = portAnswering([page(1, '')], 1, true);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'a.pdf' }),
    );

    expect(output.structured).toMatchObject({ isScanned: true });
  });

  it('decides on the extension, not on whether the bytes happen to be UTF-8', async () => {
    // An uncompressed PDF can be valid UTF-8, and would otherwise come back as
    // raw PDF source that looks like an answer and is not one.
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new TextEncoder().encode('%PDF-1.4 plain ascii body'),
    );
    const port = portAnswering([page(1)], 1);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'plain.PDF' }),
    );

    expect(port.extract).toHaveBeenCalledTimes(1);
    expect(output.structured).toMatchObject({ format: 'pdf' });
  });

  it('says a host without a backend cannot read a PDF, rather than "not UTF-8"', async () => {
    await expect(
      executorWith(undefined).execute(invocation({ rootKey: 'workspace-1', path: 'a.pdf' })),
    ).rejects.toThrow(/no backend/u);
  });

  it('still reads ordinary text files without touching the backend', async () => {
    vi.mocked(vscode.workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode('hello'));
    const port = portAnswering([], 0);

    const output = await executorWith(port).execute(
      invocation({ rootKey: 'workspace-1', path: 'README.md' }),
    );

    expect(port.extract).not.toHaveBeenCalled();
    expect(output.structured).toMatchObject({ content: 'hello' });
  });
});
