export type TokenSource = 'estimated' | 'reported';

export interface TokenReceipt {
  input: number;
  output: number;
  source: TokenSource;
  total: number;
}

export interface ReportedTokenUsage {
  input?: number;
  output?: number;
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
    source: left.source === 'reported' && right.source === 'reported' ? 'reported' : 'estimated',
    total: input + output,
  };
}
