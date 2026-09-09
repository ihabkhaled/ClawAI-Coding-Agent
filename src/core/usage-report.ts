import type { Usage } from '../backend/contracts';

export interface UsageWindowLine {
  readonly window: string;
  readonly used: number;
  readonly limit: number | null;
  readonly remaining: number | null;
  /** 0–100, or null when the window has no limit to be a fraction of. */
  readonly percentUsed: number | null;
}

export interface UsageFeatureLine {
  readonly feature: string;
  readonly allowed: boolean;
  readonly used: number;
  readonly limit: number | null;
}

export interface UsageReport {
  readonly windows: readonly UsageWindowLine[];
  readonly features: readonly UsageFeatureLine[];
}

function windowLine(window: string, source: Usage['day']): UsageWindowLine {
  const limit = source.limit;
  return {
    window,
    used: source.used,
    limit,
    remaining: source.remaining,
    // `null` limit means unlimited, and a percentage of unlimited is not zero
    // or a hundred — it is nothing, and saying so is the honest rendering.
    percentUsed: limit === null || limit === 0 ? null : Math.min(100, (source.used / limit) * 100),
  };
}

/**
 * The shape a usage dialog renders.
 *
 * Everything here already arrived with the account data and was shown only as
 * a status-bar tooltip, one line long. The report is the same numbers with
 * room to read them: three windows, then whichever features carry a limit.
 *
 * Features with no limit and no use are dropped. A list where most rows say
 * "unlimited, unused" buries the two rows that are about to run out.
 */
export function buildUsageReport(usage: Usage): UsageReport {
  return {
    windows: [
      windowLine('day', usage.day),
      windowLine('week', usage.week),
      windowLine('month', usage.month),
    ],
    features: usage.features
      .filter((feature) => feature.limit !== null || feature.used > 0)
      .map((feature) => ({
        feature: feature.feature,
        allowed: feature.allowed,
        used: feature.used,
        limit: feature.limit,
      })),
  };
}
