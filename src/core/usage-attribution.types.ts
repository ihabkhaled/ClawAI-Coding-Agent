/** What spent the tokens: a chat turn, an agent run, a saved workflow, or a sub-agent. */
export type UsageAttributionKind = 'chat' | 'agent' | 'workflow' | 'subagent';

export interface UsageAttributionSource {
  readonly kind: UsageAttributionKind;
  /** The workflow kind or sub-agent definition; the kind itself for chat and agent turns. */
  readonly name: string;
}

export interface UsageAttributionTokens {
  readonly input: number;
  readonly output: number;
  readonly cached: number;
  readonly total: number;
}

export interface UsageAttributionEntry {
  readonly source: UsageAttributionSource;
  /** `provider/model`, or `auto` when the router chose and did not say. */
  readonly model: string;
  readonly tokens: UsageAttributionTokens;
}

export interface UsageAttributionLine extends UsageAttributionTokens {
  readonly dimension: string;
  readonly turns: number;
}

export interface UsageAttributionSummary {
  readonly bySource: readonly UsageAttributionLine[];
  readonly byModel: readonly UsageAttributionLine[];
  readonly turns: number;
  readonly total: number;
}

/** A line while the ledger is still adding to it. */
export type MutableUsageAttributionLine = {
  -readonly [K in keyof UsageAttributionLine]: UsageAttributionLine[K];
};
