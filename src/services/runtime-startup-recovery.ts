import { validateRunResume } from '../core/durable-run-journal';

import type { RuntimeCommandBinding } from '../backend/backend-client.types';
import type { DurableRunJournal } from '../core/durable-run-journal';

type RuntimeFingerprint = DurableRunJournal['fingerprints'];
type LiveHandles = Parameters<typeof validateRunResume>[2];

export interface RuntimeStartupRecoveryPlan {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

function epochsMatch(
  left: RuntimeCommandBinding['epochs'],
  right: RuntimeCommandBinding['epochs'],
): boolean {
  return (
    left.account === right.account &&
    left.workspace === right.workspace &&
    left.target === right.target &&
    left.policy === right.policy
  );
}

export function planRuntimeStartupRecovery(
  journal: DurableRunJournal,
  binding: RuntimeCommandBinding | undefined,
  current: RuntimeFingerprint,
  liveHandles: LiveHandles,
): RuntimeStartupRecoveryPlan {
  const reasons: string[] = [];
  if (journal.recovery === undefined) reasons.push('missing-recovery-capsule');
  if (binding === undefined) {
    reasons.push('missing-runtime-binding');
  } else {
    if (binding.runId !== journal.runId || binding.threadId !== journal.threadId) {
      reasons.push('binding-identity');
    }
    if (
      journal.recovery !== undefined &&
      !epochsMatch(binding.epochs, journal.recovery.start.epochs)
    ) {
      reasons.push('binding-epochs');
    }
  }
  reasons.push(...validateRunResume(journal, current, liveHandles).reasons);
  return Object.freeze({
    eligible: reasons.length === 0,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}
