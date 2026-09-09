import { createHash } from 'node:crypto';

import { implementationPlanSchema } from './implementation-plan';

import type { ImplementationPlan } from './implementation-plan';
import type { PlanRevisionChange, PlanRevisionDocument } from './plan-revision.types';

/** Opens the machine-readable block an exported Markdown plan carries. */
export const PLAN_REVISION_MARKER = 'clawai-plan-revision';

const MARKER_PATTERN = /<!--\s*clawai-plan-revision\s*([\s\S]*?)-->/u;

/**
 * The plan as bytes, with object keys ordered so the same plan always hashes
 * the same way. Key order is an accident of how a plan was built; two plans
 * that differ only by it are the same plan and must not look like a revision.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
}

/**
 * The revision a plan's content is bound to.
 *
 * Computed from the plan, never from the document that carries it, so
 * reformatting the Markdown around it does not invent a revision the user
 * never made.
 */
export function planRevisionHash(plan: ImplementationPlan): string {
  return `sha256:${createHash('sha256').update(canonicalJson(plan)).digest('hex')}`;
}

/**
 * A Markdown plan the extension can read its own edits back out of.
 *
 * The rendered Markdown is what the user reads and edits; the trailing comment
 * is what survives the round trip. Prose alone is lossy — a plan re-derived
 * from headings would silently drop the fields the renderer does not print.
 */
export function embedPlanRevision(markdown: string, plan: ImplementationPlan): string {
  const revision = planRevisionHash(plan);
  const body = canonicalJson(plan);
  return `${markdown.trimEnd()}\n\n<!-- ${PLAN_REVISION_MARKER} ${revision}\n${body}\n-->\n`;
}

/**
 * The plan a user handed back, whichever of the two exported formats it is in.
 *
 * Edits to the embedded block are honoured: it is the plan of record, and a
 * user who edits it means it. Edits to the surrounding prose are not, because
 * there is no way to tell prose that restates the plan from prose about it.
 */
export function parsePlanDocument(document: string): PlanRevisionDocument {
  const trimmed = document.trim();
  const embedded = MARKER_PATTERN.exec(document);
  const source = trimmed.startsWith('{') ? trimmed : embedded?.[1];
  if (source === undefined) throw new Error('No implementation plan found in document');
  const plan = implementationPlanSchema.parse(JSON.parse(stripRevisionPrefix(source)));
  return { plan, revision: planRevisionHash(plan) };
}

/** Drops the hash the marker line repeats for humans before the JSON body. */
function stripRevisionPrefix(source: string): string {
  const start = source.indexOf('{');
  return start === -1 ? source : source.slice(start);
}

/** How an incoming revision relates to the one execution is currently bound to. */
export function describePlanRevisionChange(
  bound: string | undefined,
  incoming: string,
): PlanRevisionChange {
  if (bound === undefined) return 'new';
  return bound === incoming ? 'unchanged' : 'revised';
}

/**
 * Refuses work that names a revision other than the bound one.
 *
 * Naming no revision is allowed: a caller that never learned about revisions
 * is not asserting anything about which plan it read. Naming the wrong one is
 * an assertion that is false, and acting on it would execute a plan the user
 * has already replaced.
 */
export function assertPlanRevision(bound: string | undefined, requested: string | undefined): void {
  if (requested === undefined) return;
  if (bound === undefined) throw new Error('No plan revision has been recorded yet');
  if (bound !== requested) throw new Error(`Plan revision is stale: expected ${bound}`);
}
