import { vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
  showWarningMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  env: {
    openExternal: vscodeMocks.openExternal,
  },
  l10n: {
    t: (value: string) => value,
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
    }),
  },
  window: {
    showWarningMessage: vscodeMocks.showWarningMessage,
  },
}));

import { BrowserAuthorizationService } from '../../src/services/browser-authorization-service';

describe('BrowserAuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a callback that arrives while the browser is still opening', async () => {
    let finishOpening: ((opened: boolean) => void) | undefined;
    vscodeMocks.openExternal.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishOpening = resolve;
      }),
    );
    const backend = {
      authorizationUrl: vi.fn(() => 'https://claw.local/authorize/vscode?requestId=request-1'),
      exchangeVscodeAuthorization: vi.fn(async () => undefined),
      getProfile: vi.fn(async () => ({
        email: 'user@claw.local',
        id: 'user-1',
        role: 'ADMIN',
        username: 'claw-user',
      })),
      initializeVscodeAuthorization: vi.fn(
        async (input: { callbackUri: string; codeChallenge: string; state: string }) => {
          void input;
          return {
            authorizationPath: '/authorize/vscode?requestId=request-1',
            expiresIn: 600,
            requestId: 'request-1',
          };
        },
      ),
    };
    const service = new BrowserAuthorizationService(backend as never);
    const signIn = service.signIn();

    await vi.waitFor(() => {
      expect(backend.initializeVscodeAuthorization).toHaveBeenCalledOnce();
    });
    const state = backend.initializeVscodeAuthorization.mock.calls[0]?.[0].state;
    if (state === undefined) {
      throw new Error('The authorization request state was not captured.');
    }
    await vi.waitFor(() => {
      expect(vscodeMocks.openExternal).toHaveBeenCalledOnce();
    });
    service.handleUri({
      toString: () =>
        `vscode://clawai.clawai-coding-agent/auth/callback?code=authorization-code&state=${state}`,
    } as never);

    expect(vscodeMocks.showWarningMessage).not.toHaveBeenCalled();
    finishOpening?.(true);
    await expect(signIn).resolves.toMatchObject({ id: 'user-1' });
    expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledWith(
      'authorization-code',
      expect.any(String),
    );
  });
});
