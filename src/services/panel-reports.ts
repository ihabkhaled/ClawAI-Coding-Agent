import { selectedModelCapacity } from '../core/model-catalog';

import { AutoCompactionService } from './auto-compaction-service';
import { dropUris } from './drop-uris-command';

import type { PanelReportCollaborators, PanelReportHandlers } from './panel-reports.types';

/**
 * What the panel reports and the host resolves.
 *
 * Both handlers here exist for the same reason: the panel knows something the
 * host cannot see, and the host owns something the panel must not decide. It
 * knows a conversation's running token total and cannot know the model's
 * context window; it knows a file was dragged onto the composer and must not
 * decide whether that file may be read.
 *
 * Grouped so there is one place that states that split, rather than two
 * handlers on a coordinator that is already a composition root.
 */
export function panelReports(parts: PanelReportCollaborators): PanelReportHandlers {
  const autoCompaction = new AutoCompactionService({
    mode: () => parts.configuration().autoCompact,
    capacity: () =>
      selectedModelCapacity(
        parts.snapshot().routingMode,
        parts.snapshot().selectedModel,
        parts.snapshot().models,
      ),
    busy: () => parts.snapshot().busy,
    compact: parts.compact,
    compactSilently: parts.compactSilently,
  });
  return {
    conversationTokens: async (threadId, tokens) => {
      await autoCompaction.observe(threadId, tokens);
    },
    dropUris: async (uriList, shiftKey) => {
      await dropUris(
        { workspaceRoot: parts.workspaceRoot, appendToComposer: parts.appendToComposer },
        uriList,
        shiftKey,
      );
    },
  };
}
