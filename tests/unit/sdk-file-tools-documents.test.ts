import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RuntimeHttpError } from '../../src/headless/runtime-http-error';
import { httpDocumentText } from '../../src/sdk/document-text-http';
import { executeWorkspaceTool } from '../../src/sdk/workspace-tool-executor';

import type { ExtractTextResult, PdfTextPort } from '../../src/backend/pdf-text-client';

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function workspace(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'claw-docs-'));
  created.push(directory);
  return directory;
}

function put(root: string, relative: string, content: string | Buffer): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function reader(root: string, documents: PdfTextPort | undefined) {
  return async (args: Record<string, unknown>): Promise<unknown> =>
    executeWorkspaceTool(
      { toolName: 'workspace.file', operation: 'read', arguments: args },
      { workspace: root, allowedExecutables: ['node'] },
      undefined,
      undefined,
      undefined,
      { documents },
    );
}

function port(result: Partial<ExtractTextResult> = {}) {
  const extract = vi.fn<PdfTextPort['extract']>(async () => ({
    text: 'hello',
    pages: [{ number: 1, text: 'hello' }],
    totalPages: 1,
    isScanned: false,
    ...result,
  }));
  return { extract };
}

function failing(error: unknown): PdfTextPort {
  return {
    extract: vi.fn(async () =>
      Promise.reject(error instanceof Error ? error : new Error('failed')),
    ),
  };
}

describe('workspace.file read of documents', () => {
  it.each(['pdf', 'docx', 'xlsx', 'pptx', 'rtf'])(
    'sends a .%s file to the extractor',
    async (ext) => {
      const root = workspace();
      put(root, `docs/a.${ext}`, Buffer.from([0x50, 0x4b, 0, 1, 2]));
      const documents = port();

      const result = await reader(root, documents)({ path: `docs/a.${ext}` });

      expect(result).toMatchObject({
        path: `docs/a.${ext}`,
        format: ext,
        totalPages: 1,
        pages: [{ number: 1, text: 'hello' }],
        isScanned: false,
        truncated: false,
      });
      const sent = documents.extract.mock.calls[0]?.[0];
      expect(sent?.filename).toBe(`a.${ext}`);
      expect(sent?.contentBase64).toBe(Buffer.from([0x50, 0x4b, 0, 1, 2]).toString('base64'));
      expect(sent?.pages).toEqual(ext === 'pdf' ? { from: 1, to: 20 } : undefined);
    },
  );

  it('decides on the extension, so a PDF that is valid UTF-8 is still extracted', async () => {
    const root = workspace();
    put(root, 'plain.pdf', '%PDF-1.4 plain text body');
    const documents = port();

    await reader(root, documents)({ path: 'plain.pdf' });

    expect(documents.extract).toHaveBeenCalledOnce();
  });

  it('reads a PDF page range from startLine and endLine and points at the next page', async () => {
    const root = workspace();
    put(root, 'big.pdf', Buffer.from([1, 2, 3]));
    const documents = port({
      pages: [
        { number: 3, text: 'three' },
        { number: 4, text: 'four' },
      ],
      totalPages: 90,
    });

    const result = await reader(root, documents)({ path: 'big.pdf', startLine: 3, endLine: 4 });

    expect(documents.extract.mock.calls[0]?.[0].pages).toEqual({ from: 3, to: 4 });
    expect(result).toMatchObject({ nextPage: 5, truncated: false });
  });

  it('cuts pages at the maxChars budget', async () => {
    const root = workspace();
    put(root, 'long.pdf', Buffer.from([1]));
    const documents = port({
      pages: [
        { number: 1, text: 'a'.repeat(400) },
        { number: 2, text: 'b'.repeat(400) },
      ],
      totalPages: 2,
    });

    const result = (await reader(root, documents)({ path: 'long.pdf', maxChars: 500 })) as {
      pages: unknown[];
    };

    expect(result.pages).toHaveLength(1);
    expect(result).toMatchObject({ truncated: true, nextPage: 2 });
  });

  it('says so when the backend cannot be reached', async () => {
    const root = workspace();
    put(root, 'a.docx', Buffer.from([1]));

    await expect(
      reader(root, failing(new TypeError('fetch failed')))({ path: 'a.docx' }),
    ).rejects.toThrow(
      /Could not extract the text of a\.docx \(Word document\): the backend could not be reached/u,
    );
  });

  it('explains an old backend that answers 400 "PDF files only"', async () => {
    const root = workspace();
    put(root, 'a.xlsx', Buffer.from([1]));
    const old = failing(new RuntimeHttpError('/files/extract-text', 400, 'PDF files only'));

    await expect(reader(root, old)({ path: 'a.xlsx' })).rejects.toThrow(
      /Excel workbook, but this ClawAI backend can only read PDF files/u,
    );
  });

  it('reports a refused sign-in and other statuses without the raw body', async () => {
    const root = workspace();
    put(root, 'a.pptx', Buffer.from([1]));
    const refuse = (status: number): PdfTextPort =>
      failing(new RuntimeHttpError('/files/extract-text', status, 'secret-body'));

    await expect(reader(root, refuse(401))({ path: 'a.pptx' })).rejects.toThrow(
      /sign-in was refused/u,
    );
    const failure = reader(root, refuse(500))({ path: 'a.pptx' });
    await expect(failure).rejects.toThrow(/HTTP 500/u);
    await expect(failure).rejects.not.toThrow(/secret-body/u);
  });

  it('says a host without a backend cannot extract', async () => {
    const root = workspace();
    put(root, 'a.pdf', Buffer.from([1]));

    await expect(reader(root, undefined)({ path: 'a.pdf' })).rejects.toThrow(
      /no backend to extract its text/u,
    );
  });

  it('refuses an empty document without calling the backend', async () => {
    const root = workspace();
    put(root, 'empty.pdf', Buffer.alloc(0));
    const documents = port();

    await expect(reader(root, documents)({ path: 'empty.pdf' })).rejects.toThrow(/empty file/u);
    expect(documents.extract).not.toHaveBeenCalled();
  });

  it('keeps the 5 MB cap and never calls the backend for an oversize document', async () => {
    const root = workspace();
    put(root, 'huge.pdf', Buffer.alloc(5 * 1024 * 1024 + 1, 1));
    const documents = port();

    await expect(reader(root, documents)({ path: 'huge.pdf' })).rejects.toThrow(/read limit/u);
    expect(documents.extract).not.toHaveBeenCalled();
  });

  it.each([
    ['a.png', 'an image file'],
    ['a.mp3', 'an audio file'],
    ['a.mp4', 'a video file'],
  ])('refuses %s with the media message', async (name, phrase) => {
    const root = workspace();
    put(root, name, Buffer.from('not really media'));
    const documents = port();

    await expect(reader(root, documents)({ path: name })).rejects.toThrow(
      new RegExp(`${name} is ${phrase}, which`, 'u'),
    );
    expect(documents.extract).not.toHaveBeenCalled();
  });

  it('refuses a path that escapes the workspace', async () => {
    const root = workspace();
    const outside = workspace();
    put(outside, 'secret.pdf', Buffer.from([1]));
    const documents = port();

    await expect(
      reader(root, documents)({ path: path.join('..', path.basename(outside), 'secret.pdf') }),
    ).rejects.toThrow();
    await expect(
      reader(root, documents)({ path: path.join(outside, 'secret.pdf') }),
    ).rejects.toThrow();
    expect(documents.extract).not.toHaveBeenCalled();
  });

  it('refuses a symbolic link that points outside the workspace', async () => {
    const root = workspace();
    const outside = workspace();
    put(outside, 'secret.docx', Buffer.from([1]));
    try {
      symlinkSync(path.join(outside, 'secret.docx'), path.join(root, 'link.docx'));
    } catch {
      return;
    }
    const documents = port();

    await expect(reader(root, documents)({ path: 'link.docx' })).rejects.toThrow();
    expect(documents.extract).not.toHaveBeenCalled();
  });
});

describe('httpDocumentText', () => {
  it('posts base64 to /files/extract-text with the current bearer', async () => {
    let token: string | undefined = 'first';
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            text: 't',
            pages: [{ number: 1, text: 't' }],
            totalPages: 1,
            isScanned: false,
          }),
        ),
    );
    const documents = httpDocumentText('http://backend', () => token, fetcher);
    token = 'second';

    const result = await documents.extract({ filename: 'a.docx', contentBase64: 'AAEC' });

    expect(result.totalPages).toBe(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://backend/files/extract-text');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer second');
    expect(JSON.parse(init.body as string)).toEqual({ filename: 'a.docx', contentBase64: 'AAEC' });
  });

  it('turns a non-2xx answer into a RuntimeHttpError with its status', async () => {
    const fetcher = vi.fn(async () => new Response('PDF files only', { status: 400 }));
    const documents = httpDocumentText('http://backend', () => undefined, fetcher);

    await expect(
      documents.extract({ filename: 'a.docx', contentBase64: 'AA' }),
    ).rejects.toMatchObject({ status: 400, detail: 'PDF files only' });
  });
});
