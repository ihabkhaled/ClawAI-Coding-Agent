import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const joinPath = vi.hoisted(() =>
  vi.fn((base: string, ...segments: string[]) => [base, ...segments].join('/')),
);

vi.mock('vscode', () => ({
  Uri: {
    joinPath,
    parse: (value: string) => value,
  },
}));

import { createClawIconPath } from '../../src/views/claw-icon-path';

describe('createClawIconPath', () => {
  it('maps dark themes to white scratches and light themes to dark scratches', () => {
    const extensionUri = vscode.Uri.parse('extension-root');

    expect(createClawIconPath(extensionUri)).toEqual({
      dark: 'extension-root/resources/claw-dark.svg',
      light: 'extension-root/resources/claw-light.svg',
    });
    expect(joinPath).not.toHaveBeenCalledWith('extension-root', 'resources', 'icon.png');
  });
});
