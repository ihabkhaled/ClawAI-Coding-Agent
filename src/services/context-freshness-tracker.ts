import { checkContextFreshness } from './context-freshness-service';

import type { ContextFreshnessPort } from './context-freshness-service.types';
import type { ContextFreshness } from '../core/context-freshness.types';
import type { ExtensionState } from '../core/extension-state';

/**
 * Keeps the context view honest about ranges that have moved on.
 *
 * A `path:L-L` reference is a snapshot. Save the file afterwards and the same
 * line numbers point at different code, so the receipt claims the model read
 * something it never saw — nothing errors, and the conversation reads as though
 * it were still about the current file.
 *
 * The check runs on save rather than on a timer or on every render. A save is
 * the only moment the answer can change, and it is also the moment a person is
 * looking, so the mark appears while they still remember making the edit.
 */
export class ContextFreshnessTracker {
  private states: ReadonlyMap<string, ContextFreshness> = new Map();

  constructor(
    private readonly state: ExtensionState,
    private readonly port: ContextFreshnessPort,
    private readonly onChanged: () => void,
  ) {}

  /** What the view should show for one collected row. */
  freshness(key: string): ContextFreshness {
    return this.states.get(key) ?? 'fresh';
  }

  /**
   * Re-checks after a save, and only when the saved file is one the receipt
   * names. A workspace save storm must not re-read a receipt that has nothing
   * to do with it.
   */
  async fileSaved(path: string): Promise<void> {
    const included = this.state.snapshot.contextReceipt?.included ?? [];
    if (!included.some((inclusion) => inclusion.path === path)) {
      return;
    }
    const result = await checkContextFreshness(included, this.port);
    const next = new Map<string, ContextFreshness>();
    for (const report of result.reports) {
      const key =
        report.startLine === undefined
          ? report.path
          : `${report.path}:${String(report.startLine)}-${String(report.endLine)}`;
      next.set(key, report.state);
    }
    this.states = next;
    this.onChanged();
  }
}
