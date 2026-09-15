import type { AdvisorSelection } from '../core/advisor.types';
import type { ModelCatalogEntry } from '../core/model-catalog';

/** Reaching a second model without disturbing the run's own conversation. */
export interface AdvisorPort {
  /** Every model this account can currently reach. */
  catalog(): readonly ModelCatalogEntry[];
  /** The model the run itself is using, or an empty string under router choice. */
  runningModelKey(): string;
  /** Asks one question of one model, in a thread of its own. */
  consult(advisor: AdvisorSelection, prompt: string, signal?: AbortSignal): Promise<string>;
}
