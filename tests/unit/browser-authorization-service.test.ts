import { vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock('vscode', () => ({
  env: {
    openExternal: vscodeMocks.openExternal,
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
    }),
  },
}));

import { BrowserAuthorizationService } from '../../src/services/browser-authorization-service';

describe('BrowserAuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a one-shot loopback callback and exchanges the PKCE code', async () => {
    let completeCallback: ((code: string) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      dispose: vi.fn(),
      waitForCallback: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            completeCallback = resolve;
          }),
      ),
    };
    const callbackFactory = {
      open: vi.fn(async () => callback),
    };
    vscodeMocks.openExternal.mockResolvedValue(true);
    const backend = {
      authorizationUrl: vi.fn(() => 'https://claw.local/authorize/vscode?requestId=request-1'),
      exchangeVscodeAuthorization: vi.fn(async () => undefined),
      getProfile: vi.fn(async () => ({
        email: 'user@claw.local',
        id: 'user-1',
        role: 'ADMIN',
        username: 'claw-user',
      })),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
        expiresIn: 600,
        requestId: 'request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, callbackFactory);
    const signIn = service.signIn();

    await vi.waitFor(() => {
      expect(backend.initializeVscodeAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({ callbackUri: callback.callbackUri }),
      );
    });
    completeCallback?.('authorization-code');

    await expect(signIn).resolves.toMatchObject({ id: 'user-1' });
    expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledWith(
      'authorization-code',
      expect.any(String),
    );
    expect(callback.dispose).toHaveBeenCalledOnce();
  });

  it('closes the callback when the browser cannot open', async () => {
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      dispose: vi.fn(),
      waitForCallback: vi.fn(() => new Promise<string>(() => undefined)),
    };
    vscodeMocks.openExternal.mockResolvedValue(false);
    const service = new BrowserAuthorizationService(
      {
        authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
        initializeVscodeAuthorization: async () => ({
          authorizationPath: '/authorize/vscode?requestId=request-1',
        }),
      } as never,
      { open: vi.fn(async () => callback) },
    );

    await expect(service.signIn()).rejects.toThrow(/could not open/iu);
    expect(callback.dispose).toHaveBeenCalledOnce();
  });
});
