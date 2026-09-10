export type TokenSource = 'estimated' | 'reported';

export interface TokenReceipt {
  input: number;
  output: number;
  /**
   * The part of `input` the provider served from its prompt cache.
   *
   * A subset of the input, never an addition to it, and the distinction is
   * load-bearing in both directions. Cached tokens cost a fraction of fresh
   * ones, so counting them at full price makes a cheap conversation look
   * expensive. They still occupy the context window, so subtracting them from
   * the total would make a conversation that is about to overflow look like it
   * has room. Cheap is not the same as free of context.
   */
  cached: number;
  source: TokenSource;
  total: number;
}

export interface ReportedTokenUsage {
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
}

function normalizeCount(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, Math.round(value));
}

export function estimateTokens(value: string): TokenReceipt {
  const bytes = new TextEncoder().encode(value).byteLength;
  const input = bytes === 0 ? 0 : Math.max(1, Math.ceil(bytes / 4));
  return {
    input,
    output: 0,
    cached: 0,
    source: 'estimated',
    total: input,
  };
}

export function reconcileTokenReceipt(
  estimated: TokenReceipt,
  reported: ReportedTokenUsage,
): TokenReceipt {
  const input = reported.input === undefined ? estimated.input : normalizeCount(reported.input);
  const output = reported.output === undefined ? estimated.output : normalizeCount(reported.output);
  return {
    input,
    output,
    // Clamped to the input it is part of. A provider reporting more cached
    // tokens than prompt tokens is reporting something this cannot represent,
    // and believing it would show a cache share above one hundred per cent.
    cached: Math.min(input, normalizeCount(reported.cached)),
    source: 'reported',
    total: reported.total === undefined ? input + output : normalizeCount(reported.total),
  };
}

export function addTokenReceipts(left: TokenReceipt, right: TokenReceipt): TokenReceipt {
  const input = left.input + right.input;
  const output = left.output + right.output;
  return {
    input,
    output,
    cached: left.cached + right.cached,
    source: left.source === 'reported' && right.source === 'reported' ? 'reported' : 'estimated',
    total: input + output,
  };
}

/**
 * How much of the prompt came from cache, as a percentage.
 *
 * Reported rather than the raw pair because the number people act on is the
 * share: "forty thousand of forty-four thousand" takes a moment to read, and
 * "91% cached" says the same thing at a glance. Zero input yields zero rather
 * than a division by nothing.
 */
export function cachedShare(receipt: TokenReceipt): number {
  return receipt.input === 0 ? 0 : Math.round((receipt.cached / receipt.input) * 100);
}
