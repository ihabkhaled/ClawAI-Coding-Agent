import type { ImplementationPlan } from './implementation-plan';

/** How an incoming plan revision relates to the bound one. */
export type PlanRevisionChange = 'new' | 'revised' | 'unchanged';

/** A plan recovered from an exported document, with the revision it hashes to. */
export interface PlanRevisionDocument {
  plan: ImplementationPlan;
  revision: string;
}
