import { accessTokenExpiresAt } from '../core/access-token-expiry';

import { withRetries } from './retry-policy';
import { RuntimeHttpError } from './runtime-http-error';
import {
  FALLBACK_ROTATE_AFTER_MS,
  REFRESH_PATH,
  REFRESH_REFUSED_STATUSES,
  REQUEST_SKEW_MAX_LIFE_FRACTION,
  REQUEST_SKEW_MS,
  ROTATE_AT_LIFE_FRACTION,
} from './token-session.constants';

import type { SessionTokens, StreamAuth, TokenSessionOptions } from './token-session.types';

/**
 * The access and refresh tokens of one run, kept fresh for as long as it lasts.
 *
 * The access token lives about fifteen minutes and a flagship run lasts longer,
 * so nothing may hold a token by value: callers ask this for the current one.
 * Rotation is single-flight because the backend burns a refresh token on first
 * use and treats a second use as theft, revoking the whole family. The new pair
 * replaces the old in one assignment, so nobody ever reads a new access token
 * beside a dead refresh token.
 *
 * Tokens are never written anywhere by this class. Errors it raises are built
 * from the status alone and the server's reply with both tokens removed.
 */
export class TokenSession {
  private accessToken: string;
  private refreshToken: string | undefined;
  private issuedAt: number;
  private expiresAt: number | undefined;
  private inFlight: Promise<void> | undefined;
  private refused: RuntimeHttpError | undefined;
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: TokenSessionOptions) {
    this.fetcher = options.fetch ?? fetch;
    this.accessToken = options.tokens.accessToken;
    this.refreshToken = options.tokens.refreshToken;
    this.issuedAt = this.now();
    this.expiresAt = this.expiryOf(options.tokens);
  }

  /** The token as it is right now, with no renewal. */
  current(): string {
    return this.accessToken;
  }

  /** Whether a rotation is possible: a refresh token is held and was not refused. */
  canRefresh(): boolean {
    return this.refreshToken !== undefined && this.refused === undefined;
  }

  /** A token fit for a new request: rotated first when it is about to expire. */
  async fresh(): Promise<string> {
    if (!this.canRefresh() || !this.nearExpiry()) return this.accessToken;
    try {
      await this.rotate();
    } catch (error) {
      // A failed early rotation is not fatal while the token still works.
      if (this.expiresAt === undefined || this.now() >= this.expiresAt) throw error;
    }
    return this.accessToken;
  }

  /** Rotates after the backend rejected `rejected`; a rotation that already happened is not repeated. */
  async renewAfterRejection(rejected: string): Promise<string> {
    if (rejected === this.accessToken) {
      if (!this.canRefresh()) throw this.refused ?? this.notRenewable();
      await this.rotate();
    }
    return this.accessToken;
  }

  /** Milliseconds until the 80% point of the token's life, or undefined with nothing to rotate with. */
  msUntilRotation(): number | undefined {
    if (!this.canRefresh()) return undefined;
    const life = this.expiresAt === undefined ? undefined : this.expiresAt - this.issuedAt;
    const rotateAfter =
      life === undefined ? FALLBACK_ROTATE_AFTER_MS : life * ROTATE_AT_LIFE_FRACTION;
    return Math.max(0, this.issuedAt + rotateAfter - this.now());
  }

  /** Every concurrent caller shares one rotation. */
  rotate(): Promise<void> {
    if (this.refused !== undefined) return Promise.reject(this.refused);
    this.inFlight ??= this.exchange().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  /** The narrow view the event stream uses. */
  streamAuth(): StreamAuth {
    return {
      token: () => this.fresh(),
      renewAfterRejection: (rejected) => this.renewAfterRejection(rejected),
      msUntilRotation: () => this.msUntilRotation(),
    };
  }

  private async exchange(): Promise<void> {
    const used = this.refreshToken;
    if (used === undefined) throw this.notRenewable();
    let body: unknown;
    try {
      body = await withRetries(this.options.retry ?? {}, () => this.post(used));
    } catch (error) {
      if (error instanceof RuntimeHttpError && REFRESH_REFUSED_STATUSES.includes(error.status)) {
        // Final: asking again would replay a consumed token, which the backend punishes.
        this.refused = new RuntimeHttpError(
          'Token refresh',
          401,
          `the session could not be renewed (the refresh was refused with HTTP ${String(error.status)}); sign in again`,
        );
        throw this.refused;
      }
      throw this.scrubbed(error, used);
    }
    this.apply(body, used);
  }

  private async post(refreshToken: string): Promise<unknown> {
    const response = await this.fetcher(this.options.baseUrl + REFRESH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      ...(this.options.retry?.signal === undefined ? {} : { signal: this.options.retry.signal }),
    });
    const text = await response.text();
    if (!response.ok) throw RuntimeHttpError.fromResponse(REFRESH_PATH, response, '');
    return text.length === 0 ? {} : (JSON.parse(text) as unknown);
  }

  /** Replaces both tokens together; an answer without a usable access token changes nothing. */
  private apply(body: unknown, used: string): void {
    const tokens = (body as { tokens?: Record<string, unknown> } | null)?.tokens;
    const access = tokens?.accessToken;
    if (typeof access !== 'string' || access.length === 0) {
      throw new RuntimeHttpError(
        'Token refresh',
        502,
        'the refresh answer carried no access token',
      );
    }
    const rotated = tokens?.refreshToken;
    const expiresIn = tokens?.expiresIn;
    const next: SessionTokens = {
      accessToken: access,
      refreshToken: typeof rotated === 'string' && rotated.length > 0 ? rotated : used,
      expiresIn: typeof expiresIn === 'number' ? expiresIn : undefined,
    };
    this.accessToken = next.accessToken;
    this.refreshToken = next.refreshToken;
    this.issuedAt = this.now();
    this.expiresAt = this.expiryOf(next);
  }

  private nearExpiry(): boolean {
    if (this.expiresAt === undefined) return false;
    const life = this.expiresAt - this.issuedAt;
    const skew = Math.min(REQUEST_SKEW_MS, life * REQUEST_SKEW_MAX_LIFE_FRACTION);
    return this.expiresAt - this.now() <= skew;
  }

  private expiryOf(tokens: SessionTokens): number | undefined {
    const fromToken = accessTokenExpiresAt(tokens.accessToken);
    if (fromToken !== null) return fromToken;
    return tokens.expiresIn === undefined ? undefined : this.now() + tokens.expiresIn * 1_000;
  }

  private notRenewable(): RuntimeHttpError {
    return new RuntimeHttpError(
      'Token refresh',
      401,
      'the access token was rejected and no refresh token is available; set CLAW_REFRESH_TOKEN or sign in with email and password',
    );
  }

  /** A transport error never carries a token, but a server reply might echo one. */
  private scrubbed(error: unknown, used: string): unknown {
    if (!(error instanceof RuntimeHttpError)) return error;
    const clean = error.detail
      .split(used)
      .join('[redacted]')
      .split(this.accessToken)
      .join('[redacted]');
    return new RuntimeHttpError(error.path, error.status, clean, error.retryAfterMs);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
