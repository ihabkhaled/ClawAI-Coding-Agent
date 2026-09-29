import {
  USAGE_ATTRIBUTION_AUTO_MODEL,
  USAGE_ATTRIBUTION_MAX_DIMENSIONS,
  USAGE_ATTRIBUTION_OVERFLOW,
} from './usage-attribution.constants';

import type {
  MutableUsageAttributionLine,
  UsageAttributionEntry,
  UsageAttributionLine,
  UsageAttributionSource,
  UsageAttributionSummary,
  UsageAttributionTokens,
} from './usage-attribution.types';

function whole(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** `kind` alone when the name adds nothing, `kind: name` otherwise. */
export function attributionSourceLabel(source: UsageAttributionSource): string {
  return source.name === source.kind ? source.kind : `${source.kind}: ${source.name}`;
}

/** `provider/model`, the model alone, or `auto` when nothing names one. */
export function attributionModelLabel(provider?: string, model?: string): string {
  if (model === undefined || model.length === 0 || model === 'AUTO') {
    return USAGE_ATTRIBUTION_AUTO_MODEL;
  }
  return provider === undefined || provider.length === 0 || provider === 'AUTO'
    ? model
    : `${provider}/${model}`;
}

/** Only a total is known, as sub-agent telemetry reports. */
export function totalOnlyTokens(total: number): UsageAttributionTokens {
  return { input: 0, output: 0, cached: 0, total: whole(total) };
}

function addTo(
  lines: Map<string, MutableUsageAttributionLine>,
  key: string,
  tokens: UsageAttributionTokens,
): void {
  const dimension =
    lines.has(key) || lines.size < USAGE_ATTRIBUTION_MAX_DIMENSIONS
      ? key
      : USAGE_ATTRIBUTION_OVERFLOW;
  const line = lines.get(dimension) ?? {
    dimension,
    turns: 0,
    input: 0,
    output: 0,
    cached: 0,
    total: 0,
  };
  line.turns += 1;
  line.input += whole(tokens.input);
  line.output += whole(tokens.output);
  line.cached += whole(tokens.cached);
  line.total += whole(tokens.total);
  lines.set(dimension, line);
}

function ranked(lines: Map<string, MutableUsageAttributionLine>): UsageAttributionLine[] {
  return [...lines.values()]
    .map((line) => ({ ...line }))
    .sort(
      (left, right) => right.total - left.total || left.dimension.localeCompare(right.dimension),
    );
}

/**
 * What this session spent, split by what spent it.
 *
 * The account ledger on the server knows the day, week and month totals but
 * not which workflow or sub-agent drove them; this window does, at the moment
 * each turn finishes. Aggregates only — no prompt or answer text is kept, so
 * it holds nothing zero data retention would have to purge.
 */
export class UsageAttributionLedger {
  private readonly sources = new Map<string, MutableUsageAttributionLine>();
  private readonly models = new Map<string, MutableUsageAttributionLine>();
  private turns = 0;
  private total = 0;

  record(entry: UsageAttributionEntry): void {
    addTo(this.sources, attributionSourceLabel(entry.source), entry.tokens);
    addTo(this.models, entry.model, entry.tokens);
    this.turns += 1;
    this.total += whole(entry.tokens.total);
  }

  summary(): UsageAttributionSummary {
    return {
      bySource: ranked(this.sources),
      byModel: ranked(this.models),
      turns: this.turns,
      total: this.total,
    };
  }

  clear(): void {
    this.sources.clear();
    this.models.clear();
    this.turns = 0;
    this.total = 0;
  }
}

/** The one ledger for this window's session. Reset only by reloading the window. */
export const sessionUsageAttribution = new UsageAttributionLedger();
