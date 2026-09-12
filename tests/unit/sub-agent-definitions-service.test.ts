import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeEnvironment = vi.hoisted(() => ({
  fileBytes: undefined as Uint8Array | undefined,
  fileErrorCode: undefined as string | undefined,
}));

vi.mock('vscode', () => {
  class FileSystemError extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  }
  return {
    FileSystemError,
    Uri: {
      file: (path: string) => ({ path, scheme: 'file', toString: () => `file://${path}` }),
      joinPath: (
        base: { path: string; scheme: string; toString(): string },
        ...parts: string[]
      ) => ({
        path: [base.path, ...parts].join('/'),
        scheme: base.scheme,
        toString: () => `${base.toString()}/${parts.join('/')}`,
      }),
    },
    l10n: {
      t: (message: string) => message,
    },
    workspace: {
      fs: {
        readFile: vi.fn(async () => {
          if (vscodeEnvironment.fileErrorCode !== undefined) {
            throw new FileSystemError(vscodeEnvironment.fileErrorCode);
          }
          return vscodeEnvironment.fileBytes ?? new Uint8Array();
        }),
      },
    },
  };
});

import { SubAgentDefinitionsService } from '../../src/services/sub-agent-definitions-service';

describe('SubAgentDefinitionsService', () => {
  beforeEach(() => {
    vscodeEnvironment.fileBytes = undefined;
    vscodeEnvironment.fileErrorCode = undefined;
  });

  it('returns an empty list when agents.json does not exist', async () => {
    vscodeEnvironment.fileErrorCode = 'FileNotFound';
    const service = new SubAgentDefinitionsService(() => '/workspace');

    await expect(service.load()).resolves.toEqual([]);
  });

  it('parses valid definitions from agents.json', async () => {
    const definitions = [
      {
        name: 'strict-reviewer',
        description: 'Reviews for correctness and security.',
        systemPrompt: 'Flag every unverified claim.',
      },
    ];
    vscodeEnvironment.fileBytes = new TextEncoder().encode(JSON.stringify(definitions));
    const service = new SubAgentDefinitionsService(() => '/workspace');

    await expect(service.load()).resolves.toEqual(definitions);
  });

  it('rejects malformed definitions rather than silently dropping them', async () => {
    vscodeEnvironment.fileBytes = new TextEncoder().encode(JSON.stringify([{ name: 'x' }]));
    const service = new SubAgentDefinitionsService(() => '/workspace');

    await expect(service.load()).rejects.toThrow();
  });

  it('rethrows a non-not-found filesystem error', async () => {
    vscodeEnvironment.fileErrorCode = 'NoPermissions';
    const service = new SubAgentDefinitionsService(() => '/workspace');

    await expect(service.load()).rejects.toThrow();
  });
});
