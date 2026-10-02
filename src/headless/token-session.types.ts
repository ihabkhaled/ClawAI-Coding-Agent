import type { RetryContext } from './retry-policy.types';

/** The pair a sign-in returns; the refresh token is absent for a static access token. */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  /** Seconds, used only when the access token carries no readable `exp`. */
  readonly expiresIn?: number | undefined;
}

export interface TokenSessionOptions {
  readonly baseUrl: string;
  readonly tokens: SessionTokens;
  readonly retry?: RetryContext | undefined;
  readonly now?: (() => number) | undefined;
  readonly fetch?: typeof fetch | undefined;
}

/** What the event stream needs from a session; kept narrow so the stream does not own tokens. */
export interface StreamAuth {
  /** A token valid for a new request, renewed first when it is about to expire. */
  readonly token: () => Promise<string>;
  /** Renews after the backend rejected `rejected`; resolves with the token to use now. */
  readonly renewAfterRejection: (rejected: string) => Promise<string>;
  /** Milliseconds until the token should be rotated, or undefined when it cannot be. */
  readonly msUntilRotation: () => number | undefined;
}
