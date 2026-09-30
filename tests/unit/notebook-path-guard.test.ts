import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    file: (fsPath: string) => ({ scheme: 'file', fsPath }),
    joinPath: (base: { path: string }, rel: string) => ({
      scheme: 'remote',
      path: `${base.path}/${rel}`,
    }),
  },
  extensions: { getExtension: () => ({ id: 'jupyter' }) },
  workspace: {
    fs: { readFile: async (uri: { fsPath: string }) => new TextEncoder().encode(uri.fsPath) },
    openNotebookDocument: vi.fn(async () => {
      throw new Error('opened');
    }),
  },
}));

import { resolveNotebookUri } from '../../src/infrastructure/notebook-path-guard';
import { VscodeNotebookKernel } from '../../src/infrastructure/vscode-notebook-kernel';
import { VscodeNotebookReader } from '../../src/infrastructure/vscode-notebook-reader';

let root = '';
let outside = '';
const rootUri = () => ({ scheme: 'file', fsPath: root }) as never;

function tryLink(link: string, target: string): boolean {
  try {
    symlinkSync(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'nbroot-'));
  outside = mkdtempSync(path.join(os.tmpdir(), 'nbout-'));
  writeFileSync(path.join(root, 'ok.ipynb'), '{}');
  writeFileSync(path.join(outside, 'secret.ipynb'), '{}');
  mkdirSync(path.join(root, 'sub'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('notebook path containment', () => {
  it('accepts a notebook inside the root', () => {
    expect(resolveNotebookUri(rootUri(), 'ok.ipynb')).toMatchObject({
      fsPath: path.resolve(root, 'ok.ipynb'),
    });
    expect(() => resolveNotebookUri(rootUri(), 'sub/new.ipynb')).not.toThrow();
  });

  it.each([
    ['traversal', '../secret.ipynb'],
    ['nested traversal', 'sub/../../secret.ipynb'],
    ['backslash traversal', '..\\secret.ipynb'],
    ['posix absolute', '/etc/passwd.ipynb'],
    ['windows absolute', 'C:\\Users\\x\\a.ipynb'],
    ['drive letter forward slash', 'C:/Users/x/a.ipynb'],
    ['drive relative', 'C:a.ipynb'],
    ['UNC', '\\\\server\\share\\a.ipynb'],
    ['UNC forward', '//server/share/a.ipynb'],
    ['device path', '\\\\.\\C:\\a.ipynb'],
    ['reserved device name', 'nul.ipynb'],
    ['empty', ''],
    ['sensitive', '.env'],
  ])('refuses %s', (_name, candidate) => {
    expect(() => resolveNotebookUri(rootUri(), candidate)).toThrow();
  });

  it('refuses a symlink that leaves the workspace', () => {
    if (!tryLink(path.join(root, 'link'), outside)) return;
    expect(() => resolveNotebookUri(rootUri(), 'link/secret.ipynb')).toThrow(
      /inside the workspace/u,
    );
    expect(() => resolveNotebookUri(rootUri(), 'link')).toThrow();
  });

  it('refuses a notebook that is itself a link', () => {
    if (!tryLink(path.join(root, 'nb.ipynb'), path.join(outside, 'secret.ipynb'))) return;
    expect(() => resolveNotebookUri(rootUri(), 'nb.ipynb')).toThrow();
  });

  it('gives a remote root the lexical rule only', () => {
    const remote = { scheme: 'vscode-remote', path: '/w' } as never;
    expect(resolveNotebookUri(remote, 'a.ipynb')).toMatchObject({ path: '/w/a.ipynb' });
    expect(() => resolveNotebookUri(remote, '../a.ipynb')).toThrow();
  });
});

describe('notebook reader and kernel use the guard', () => {
  it('reader reads inside and refuses outside', async () => {
    const reader = new VscodeNotebookReader(rootUri);
    await expect(reader.read('w', 'ok.ipynb')).resolves.toContain('ok.ipynb');
    await expect(reader.read('w', '../x.ipynb')).rejects.toThrow(/inside the workspace/u);
    await expect(reader.read('w', 'C:\\x.ipynb')).rejects.toThrow();
    await expect(reader.read('w', '\\\\srv\\s\\x.ipynb')).rejects.toThrow();
  });

  it('kernel refuses an escaping path before opening anything', async () => {
    const kernel = new VscodeNotebookKernel(rootUri);
    await expect(
      kernel.run({ rootKey: 'w', path: '../x.ipynb', timeoutMs: 1_000 }),
    ).rejects.toThrow(/inside the workspace/u);
    await expect(
      kernel.run({ rootKey: 'w', path: '/abs.ipynb', timeoutMs: 1_000 }),
    ).rejects.toThrow();
  });
});
