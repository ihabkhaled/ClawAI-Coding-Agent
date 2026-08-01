import { vi } from 'vitest';

const vscodeMocks = vi.hoisted(() => ({
  openExternal: vi.fn(),
}));

vi.mock('vscode', () => ({
  env: {
    openExternal: vscodeMocks.openExternal,
  },
  l10n: {
    t: (message: string) => message,
  },
  Uri: {
    parse: (value: string) => ({
      toString: () => value,
    }),
  },
}));

import {
  AuthorizationCancelledError,
  BrowserAuthorizationService,
} from '../../src/services/browser-authorization-service';

const tokens = {
  accessToken: 'candidate-access',
  refreshToken: 'candidate-refresh',
  expiresIn: 900,
  refreshExpiresIn: 2_592_000,
  tokenType: 'Bearer' as const,
};

describe('BrowserAuthorizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses a one-shot loopback callback and exchanges the PKCE code', async () => {
    let completeCallback: ((code: string) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
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
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(async () => ({
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
        expect.any(AbortSignal),
      );
    });
    completeCallback?.('authorization-code');

    await expect(signIn).resolves.toMatchObject({ user: { id: 'user-1' }, tokens });
    expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledWith(
      'authorization-code',
      expect.any(String),
      expect.any(AbortSignal),
    );
    expect(callback.confirmAuthorization).toHaveBeenCalledOnce();
    expect(callback.rejectAuthorization).not.toHaveBeenCalled();
    expect(callback.dispose).toHaveBeenCalledOnce();
  });

  it('shows callback failure when candidate profile verification fails', async () => {
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(async () => 'authorization-code'),
    };
    vscodeMocks.openExternal.mockResolvedValue(true);
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(async () => {
        throw new Error('profile rejected');
      }),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, {
      open: vi.fn(async () => callback),
    });

    await expect(service.signIn()).rejects.toThrow('profile rejected');
    expect(callback.confirmAuthorization).not.toHaveBeenCalled();
    expect(callback.rejectAuthorization).toHaveBeenCalledOnce();
    expect(callback.dispose).toHaveBeenCalledOnce();
  });

  it('does not block the callback exchange when the OS browser opener stays pending', async () => {
    let completeCallback: ((code: string) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            completeCallback = resolve;
          }),
      ),
    };
    vscodeMocks.openExternal.mockReturnValue(new Promise<boolean>(() => undefined));
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(async () => ({
        email: 'user@claw.local',
        id: 'user-1',
        role: 'ADMIN',
        username: 'claw-user',
      })),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, {
      open: vi.fn(async () => callback),
    });
    const signIn = service.signIn();

    await vi.waitFor(() => {
      expect(vscodeMocks.openExternal).toHaveBeenCalledOnce();
    });
    completeCallback?.('authorization-code');

    await expect(signIn).resolves.toMatchObject({ user: { id: 'user-1' }, tokens });
    expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledOnce();
  });

  it('closes the callback when the browser cannot open', async () => {
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
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

  it('shares one browser authorization attempt across concurrent sign-ins', async () => {
    let completeCallback: ((code: string) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            completeCallback = resolve;
          }),
      ),
    };
    const callbackFactory = { open: vi.fn(async () => callback) };
    vscodeMocks.openExternal.mockResolvedValue(true);
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(async () => ({ id: 'user-1' })),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, callbackFactory);

    const first = service.signIn();
    const second = service.signIn();
    await vi.waitFor(() => {
      expect(backend.initializeVscodeAuthorization).toHaveBeenCalledOnce();
    });
    completeCallback?.('authorization-code');

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(callbackFactory.open).toHaveBeenCalledOnce();
    expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledOnce();
  });

  it('cancels an authorization before the loopback callback finishes opening', async () => {
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(async () => 'authorization-code'),
    };
    const callbackFactory = {
      open: vi
        .fn()
        .mockReturnValueOnce(new Promise<never>(() => undefined))
        .mockResolvedValueOnce(callback),
    };
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-2',
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(async () => ({ id: 'user-1' })),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-2',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, callbackFactory);
    const signIn = service.signIn();

    expect(service.cancel()).toBe(true);
    const cancellation = await Promise.race([
      signIn.catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve('still pending');
        }, 20);
      }),
    ]);

    expect(cancellation).toBeInstanceOf(AuthorizationCancelledError);
    await expect(service.signIn()).resolves.toMatchObject({ user: { id: 'user-1' }, tokens });
    expect(callbackFactory.open).toHaveBeenCalledTimes(2);
    expect(backend.initializeVscodeAuthorization).toHaveBeenCalledOnce();
    expect(callback.dispose).toHaveBeenCalledOnce();
  });

  it('times out a stalled callback and immediately generates a fresh authorization link', async () => {
    vi.useFakeTimers();
    try {
      const firstCallback = {
        callbackUri: 'http://127.0.0.1:49152/auth/callback',
        confirmAuthorization: vi.fn(),
        dispose: vi.fn(),
        rejectAuthorization: vi.fn(),
        waitForCallback: vi.fn(() => new Promise<string>(() => undefined)),
      };
      const secondCallback = {
        callbackUri: 'http://127.0.0.1:49153/auth/callback',
        confirmAuthorization: vi.fn(),
        dispose: vi.fn(),
        rejectAuthorization: vi.fn(),
        waitForCallback: vi.fn(async () => 'authorization-code'),
      };
      const callbackFactory = {
        open: vi.fn().mockResolvedValueOnce(firstCallback).mockResolvedValueOnce(secondCallback),
      };
      vscodeMocks.openExternal.mockResolvedValue(true);
      const backend = {
        authorizationUrl: vi.fn((path: string) => `https://claw.local${path}`),
        exchangeVscodeAuthorization: vi.fn(async () => tokens),
        getProfileWithAccessToken: vi.fn(async () => ({ id: 'user-1' })),
        initializeVscodeAuthorization: vi
          .fn()
          .mockResolvedValueOnce({
            authorizationPath: '/authorize/vscode?requestId=request-1',
          })
          .mockResolvedValueOnce({
            authorizationPath: '/authorize/vscode?requestId=request-2',
          }),
      };
      const service = new BrowserAuthorizationService(backend as never, callbackFactory, 1_000);
      const first = service.signIn();
      const firstResult = first.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(0);
      expect(vscodeMocks.openExternal).toHaveBeenCalledOnce();
      const firstSignal = backend.initializeVscodeAuthorization.mock.calls[0]?.[1] as AbortSignal;

      await vi.advanceTimersByTimeAsync(1_000);

      await expect(firstResult).resolves.toMatchObject({
        message: 'ClawAI authorization timed out. Please try again.',
      });
      expect(firstSignal.aborted).toBe(true);
      expect(firstCallback.dispose).toHaveBeenCalledOnce();

      await expect(service.signIn()).resolves.toMatchObject({
        user: { id: 'user-1' },
        tokens,
      });
      expect(vscodeMocks.openExternal).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          toString: expect.any(Function),
        }),
      );
      expect(backend.authorizationUrl).toHaveBeenNthCalledWith(
        2,
        '/authorize/vscode?requestId=request-2',
      );
      expect(callbackFactory.open).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot complete after cancellation while exchanging the authorization code', async () => {
    let completeExchange: ((value: typeof tokens) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(async () => 'authorization-code'),
    };
    vscodeMocks.openExternal.mockResolvedValue(true);
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
      exchangeVscodeAuthorization: vi.fn(
        () =>
          new Promise<typeof tokens>((resolve) => {
            completeExchange = resolve;
          }),
      ),
      getProfileWithAccessToken: vi.fn(),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, {
      open: vi.fn(async () => callback),
    });
    const signIn = service.signIn();
    await vi.waitFor(() => {
      expect(backend.exchangeVscodeAuthorization).toHaveBeenCalledOnce();
    });

    expect(service.cancel()).toBe(true);
    completeExchange?.(tokens);

    await expect(signIn).rejects.toBeInstanceOf(AuthorizationCancelledError);
    expect(backend.getProfileWithAccessToken).not.toHaveBeenCalled();
  });

  it('cannot complete after cancellation while validating the candidate profile', async () => {
    let completeProfile: ((value: { id: string }) => void) | undefined;
    const callback = {
      callbackUri: 'http://127.0.0.1:49152/auth/callback',
      confirmAuthorization: vi.fn(),
      dispose: vi.fn(),
      rejectAuthorization: vi.fn(),
      waitForCallback: vi.fn(async () => 'authorization-code'),
    };
    vscodeMocks.openExternal.mockResolvedValue(true);
    const backend = {
      authorizationUrl: () => 'https://claw.local/authorize/vscode?requestId=request-1',
      exchangeVscodeAuthorization: vi.fn(async () => tokens),
      getProfileWithAccessToken: vi.fn(
        () =>
          new Promise<{ id: string }>((resolve) => {
            completeProfile = resolve;
          }),
      ),
      initializeVscodeAuthorization: vi.fn(async () => ({
        authorizationPath: '/authorize/vscode?requestId=request-1',
      })),
    };
    const service = new BrowserAuthorizationService(backend as never, {
      open: vi.fn(async () => callback),
    });
    const signIn = service.signIn();
    await vi.waitFor(() => {
      expect(backend.getProfileWithAccessToken).toHaveBeenCalledOnce();
    });

    expect(service.cancel()).toBe(true);
    completeProfile?.({ id: 'user-1' });

    await expect(signIn).rejects.toBeInstanceOf(AuthorizationCancelledError);
  });
});
