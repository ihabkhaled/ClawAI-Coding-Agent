import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const environment = vi.hoisted(() => ({
  folder: undefined as { fsPath: string; scheme: string; toString(): string } | undefined,
}));

vi.mock('vscode', () => ({
  l10n: { t: (message: string, value?: string) => message.replace('{0}', value ?? '') },
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    showOpenDialog: vi.fn(async () =>
      environment.folder === undefined ? undefined : [environment.folder],
    ),
    showQuickPick: vi.fn(async (items: { rootKey: string }[]) => items[0]),
    showWarningMessage: vi.fn(async () => undefined),
  },
  workspace: { isTrusted: true },
}));

import { ExternalOutputGrantService } from '../../src/services/external-output-grant-service';

describe('ExternalOutputGrantService', () => {
  beforeEach(() => {
    environment.folder = {
      fsPath: 'D:\\Freelance\\Packs, Plans, And Prompts',
      scheme: 'file',
      toString: () => 'file:///D:/Freelance/Packs,%20Plans,%20And%20Prompts',
    };
    vi.clearAllMocks();
  });

  it('uses the native folder picker and creates an output-only grant', async () => {
    const grant = vi.fn(async () => undefined);
    const service = new ExternalOutputGrantService({
      grant,
      revoke: vi.fn(async () => undefined),
      snapshot: () => [],
    } as never);

    await service.manage();

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ canSelectFiles: false, canSelectFolders: true }),
    );
    expect(grant).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Packs, Plans, And Prompts',
        uri: 'file:///D:/Freelance/Packs,%20Plans,%20And%20Prompts',
      }),
    );
  });
});
