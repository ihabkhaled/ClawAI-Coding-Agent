import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

import { WorkspaceContextService } from '../../src/services/workspace-context-service';

import type { RuntimeConfiguration } from '../../src/services/configuration-service';

const vscodeEnvironment = vi.hoisted(() => ({
  activeTextEditor: undefined as
    | {
        document: {
          uri: { fsPath: string; path: string; scheme: string; toString(): string };
          getText(): string;
        };
        selection: { isEmpty: boolean };
      }
    | undefined,
  trusted: true,
  workspaceFolders: [] as {
    name: string;
    uri: { fsPath: string; path: string; scheme: string; toString(): string };
  }[],
}));

const realpathEnvironment = vi.hoisted(() => ({
  errors: new Map<string, unknown>(),
  paths: new Map<string, string>(),
}));

vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => {
    if (realpathEnvironment.errors.has(value)) {
      throw realpathEnvironment.errors.get(value);
    }
    return realpathEnvironment.paths.get(value) ?? value;
  }),
}));

vi.mock('vscode', () => ({
  FileType: { File: 1 },
  FileSystemError: class FileSystemError extends Error {
    code = 'FileNotFound';
  },
  Uri: {
    joinPath: (base: { path: string; scheme: string; toString(): string }, ...parts: string[]) => ({
      fsPath: [base.path, ...parts].join('/'),
      path: [base.path, ...parts].join('/'),
      scheme: base.scheme,
      toString: () => `${base.toString()}/${parts.join('/')}`,
    }),
  },
  RelativePattern: class RelativePattern {
    constructor(
      readonly base: { name: string },
      readonly pattern: string,
    ) {}
  },
  l10n: {
    t: (message: string) => message,
  },
  window: {
    get activeTextEditor() {
      return vscodeEnvironment.activeTextEditor;
    },
  },
  workspace: {
    asRelativePath: (uri: { path: string }) => uri.path.replace('/workspace/', ''),
    findFiles: vi.fn(async () => []),
    getWorkspaceFolder: (uri: { path: string }) =>
      vscodeEnvironment.workspaceFolders.find((folder) =>
        uri.path.startsWith(`${folder.uri.path}/`),
      ),
    fs: {
      readFile: vi.fn(async () => new Uint8Array()),
      stat: vi.fn(),
    },
    get isTrusted() {
      return vscodeEnvironment.trusted;
    },
    get workspaceFolders() {
      return vscodeEnvironment.workspaceFolders;
    },
  },
}));

const configuration: RuntimeConfiguration = {
  agentMode: 'AUTO',
  effortMode: 'ULTRA',
  speedMode: '1X',
  backendUrl: 'https://claw.local',
  exclude: [],
  historyLimit: 50,
  maxContextBytes: 10_000,
  maxContextFiles: 10,
  permissionMode: 'MANUAL',
  requestTimeoutMs: 60_000,
  routingMode: 'AUTO',
  selectedModel: '',
};

describe('WorkspaceContextService speed modes', () => {
  const uriFor = (name: string) => ({
    fsPath: `/workspace/${name}`,
    path: `/workspace/${name}`,
    scheme: 'file',
    toString: () => `file:///workspace/${name}`,
  });

  beforeEach(() => {
    realpathEnvironment.errors.clear();
    realpathEnvironment.paths.clear();
    vscodeEnvironment.activeTextEditor = undefined;
    vscodeEnvironment.trusted = true;
    vscodeEnvironment.workspaceFolders = [
      {
        name: 'claw-workspace',
        uri: {
          fsPath: '/workspace',
          path: '/workspace',
          scheme: 'file',
          toString: () => 'file:///workspace',
        },
      },
    ];
    vi.clearAllMocks();
  });

  afterEach(() => {
    // clearAllMocks resets calls, not implementations. Without this the staged
    // findFiles result leaks into later suites as phantom workspace files.
    vi.mocked(vscode.workspace.findFiles).mockImplementation(async () => []);
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => new Uint8Array());
    vi.mocked(vscode.workspace.fs.stat).mockReset();
  });

  function stageFiles(count: number, sizeBytes: number): void {
    const names = Array.from({ length: count }, (_value, index) => `file-${String(index)}.ts`);
    vi.mocked(vscode.workspace.findFiles).mockResolvedValue(names.map(uriFor) as never);
    vi.mocked(vscode.workspace.fs.stat).mockImplementation(
      async () => ({ size: sizeBytes, type: vscode.FileType.File }) as never,
    );
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri: { path: string }) =>
      new TextEncoder().encode(uri.path.padEnd(sizeBytes, '.').slice(0, sizeBytes)),
    );
  }

  it('produces an identical context at every speed, including under the byte limit', async () => {
    // The read loop is order dependent: which files fit depends on how many
    // bytes the ones before them consumed. If speed changed that, the agent
    // would silently see different code at 2X than at 1X.
    const results = [];
    for (const speedMode of ['1X', '1.5X', '2X'] as const) {
      stageFiles(12, 100);
      const service = new WorkspaceContextService();
      results.push(
        await service.workspace({
          ...configuration,
          maxContextBytes: 450,
          maxContextFiles: 10,
          speedMode,
        }),
      );
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    // Guard against the whole comparison being vacuous.
    expect(results[0]?.receipt.included.length).toBeGreaterThan(0);
    expect(results[0]?.receipt.truncated).toBe(true);
  });

  it('overlaps metadata lookups at 2X and issues them one at a time at 1X', async () => {
    // Speed parallelises the containment check and the stat. It deliberately
    // does not parallelise reading bytes — that stays conditional on the size
    // check, so a run never pulls a near-limit candidate into memory just to
    // discard it.
    for (const [speedMode, expectedPeak] of [
      ['1X', 1],
      ['2X', 8],
    ] as const) {
      stageFiles(16, 10);
      let inFlight = 0;
      let peak = 0;
      vi.mocked(vscode.workspace.fs.stat).mockImplementation(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return { size: 10, type: vscode.FileType.File } as never;
      });
      const service = new WorkspaceContextService();
      await service.workspace({ ...configuration, maxContextFiles: 16, speedMode });
      expect(peak, `${speedMode} peaked at ${String(peak)}`).toBe(expectedPeak);
    }
  });

  it('keeps byte reads serial and conditional at the highest speed', async () => {
    stageFiles(20, 8);
    let peak = 0;
    let inFlight = 0;
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new TextEncoder().encode('12345678');
    });
    const service = new WorkspaceContextService();
    await service.workspace({
      ...configuration,
      maxContextBytes: 10,
      maxContextFiles: 2,
      speedMode: '2X',
    });
    expect(peak).toBe(1);
    // One file fits in ten bytes. Even at 2X, only that one is loaded.
    // `.clawai/ignore` is read separately and is not a candidate.
    const candidateReads = vi
      .mocked(vscode.workspace.fs.readFile)
      .mock.calls.filter(([uri]) => (uri as { path: string }).path.includes('/file-'));
    expect(candidateReads).toHaveLength(1);
  });
});
