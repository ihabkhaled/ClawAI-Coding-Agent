/**
 * Whether a request should be delivered through the flagship pipeline.
 *
 * Flagship exists for briefs that carry several independent deliverables: it
 * plans a task graph, runs disjoint lanes in parallel, and gates the result.
 * For a single edit it is pure overhead — a planning round, a worktree, and an
 * integration pass to land one file.
 *
 * Admission is therefore host-owned and deliberately narrow. It keys on the one
 * signal that actually predicts benefit and that a reader can check for
 * themselves: the brief enumerates its deliverables. A request that lists four
 * numbered parts is a request the planner can decompose; a paragraph asking for
 * one change is not, however long it happens to be. Length alone is not a
 * signal — a verbose bug report is still one bug.
 */

// Scanning is bounded because the prompt is untrusted input and this runs on
// every admitted run, not because a longer brief would change the outcome.
const SCANNED_CHARACTERS = 20_000;

// Two parts are as easily done in sequence, and the planning round would cost
// more than it saves. Three is where independent lanes start paying for
// themselves.
const ENUMERATED_PART_THRESHOLD = 3;

// Numbered items and the "PART 1" heading style a brief uses for its top-level
// deliverables. Anchored per line so prose mentioning "1." mid sentence does
// not count. Plain bullets are deliberately excluded: they are usually the
// sub-points of one deliverable, and counting them would admit any brief that
// happened to explain a single change as a list.
const ENUMERATED_LINE = /^\s{0,8}(?:(?:\d{1,2}[.)])|(?:part|step|task)\s+\d{1,2}\b)/iu;

export interface FlagshipAdmission {
  readonly admit: boolean;
  readonly reason: string;
  readonly enumeratedParts: number;
}

export function flagshipAdmission(prompt: string): FlagshipAdmission {
  const enumeratedParts = countEnumeratedParts(prompt);
  if (enumeratedParts >= ENUMERATED_PART_THRESHOLD) {
    return {
      admit: true,
      reason: `The brief enumerates ${String(enumeratedParts)} deliverables, which the planner can run as separate lanes.`,
      enumeratedParts,
    };
  }
  return {
    admit: false,
    reason:
      'The brief does not enumerate enough independent deliverables to be worth planning as a graph.',
    enumeratedParts,
  };
}

function countEnumeratedParts(prompt: string): number {
  const lines = prompt.slice(0, SCANNED_CHARACTERS).split(/\r?\n/);
  // A brief can mix styles ("PART 1" headings with bullets beneath), so the
  // same line is never counted twice and blank markers are ignored.
  return lines.filter((line) => ENUMERATED_LINE.test(line) && line.trim().length > 2).length;
}

/**
 * Rewrites the flagship tool's description when the host has admitted a brief.
 *
 * A tool description is the only guidance that reaches the model, so admission
 * is expressed there rather than as a separate instruction the model could
 * treat as optional. The rewrite states the host's decision and the reason for
 * it; the catalog hash is computed after this runs, so the description the
 * model reads is the one the run committed to.
 */
export function withFlagshipRequirement<
  Definition extends { readonly name: string; readonly description: string },
>(definitions: readonly Definition[], admission: FlagshipAdmission): readonly Definition[] {
  if (!admission.admit) return definitions;
  return definitions.map((definition) =>
    definition.name === 'runtime.flagship'
      ? {
          ...definition,
          description: `${definition.description} REQUIRED FOR THIS REQUEST: ${admission.reason} Deliver it through this tool rather than editing files directly.`,
        }
      : definition,
  );
}
