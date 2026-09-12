import type { FastModeSettings } from '../core/fast-mode.types';

/** What toggling Fast mode needs to reach. */
export interface FastModeDependencies {
  readonly current: () => FastModeSettings;
  readonly apply: (settings: FastModeSettings) => Promise<void>;
  /** Where the pair to restore is kept, so the toggle survives a reload. */
  readonly remembered: () => FastModeSettings | undefined;
  readonly remember: (settings: FastModeSettings | undefined) => Promise<void>;
}
