import { planRuntimeStartupRecovery } from './runtime-startup-recovery';
import { recoverRuntimeStudio } from './runtime-studio-execution';

import type { RunJournalService } from './run-journal-service';
import type { RuntimeStudioExecutionDependencies } from './runtime-studio-execution';
import type { RuntimeStudioInput } from './runtime-studio.types';
import type { CapabilityManifest } from '../core/runtime/capability-manifest';
import type { VscodeRuntimeBindingStore } from '../infrastructure/vscode-runtime-binding-store';

interface RecoveryLogger {
  warn(message: string, details?: unknown): void;
}

interface VscodeRuntimeRecoveryDependencies {
  readonly bindings: VscodeRuntimeBindingStore;
  readonly journals: RunJournalService;
  readonly logger: RecoveryLogger;
  readonly fingerprint: (
    signal: AbortSignal,
  ) => Promise<Parameters<typeof planRuntimeStartupRecovery>[2]>;
  readonly setEpochs: (
    epochs: NonNullable<Parameters<typeof planRuntimeStartupRecovery>[1]>['epochs'],
  ) => void;
  readonly execution: (
    input: RuntimeStudioInput,
    manifest: CapabilityManifest,
  ) => RuntimeStudioExecutionDependencies;
  readonly recover?: typeof recoverRuntimeStudio;
}

export async function recoverVscodeRuntime(
  dependencies: VscodeRuntimeRecoveryDependencies,
  input: RuntimeStudioInput,
  manifest: CapabilityManifest,
): Promise<boolean> {
  const bindings = new Map(
    (await dependencies.bindings.list()).map((binding) => [binding.runId, binding]),
  );
  const journals = [...(await dependencies.journals.list())].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  for (const journal of journals) {
    if (['completed', 'cancelled', 'abandoned'].includes(journal.lifecycle)) continue;
    const binding = bindings.get(journal.runId);
    if (binding !== undefined) dependencies.setEpochs(binding.epochs);
    const plan = planRuntimeStartupRecovery(
      journal,
      binding,
      await dependencies.fingerprint(input.signal),
      { processes: new Set<string>(), services: new Set<string>() },
    );
    if (!plan.eligible || binding === undefined) {
      await dependencies.journals.save({ ...journal, lifecycle: 'blocked-by-drift' });
      dependencies.logger.warn('Runtime startup recovery blocked', {
        runId: journal.runId,
        reasons: plan.reasons,
      });
      continue;
    }
    await (dependencies.recover ?? recoverRuntimeStudio)(
      dependencies.execution(input, manifest),
      journal,
      binding,
    );
    return true;
  }
  return false;
}
