import { randomUUID } from 'node:crypto';

import { isRuntimeRunEnded } from '../core/runtime/runtime-event-reducer';

import { RuntimeJournalTracker } from './runtime-journal-tracker';
import { RuntimeRunService } from './runtime-run-service';

import type { RuntimeConfiguration } from './configuration-service';
import type { FlagshipDeliveryService } from './flagship-delivery-service';
import type { LocalObservabilityService } from './observability-service';
import type { RunJournalService } from './run-journal-service';
import type { RuntimeEventStreamService } from './runtime-event-stream-service';
import type { RuntimePolicyV2Adapter } from './runtime-policy-v2-adapter';
import type { RuntimeStudioInput } from './runtime-studio.types';
import type { RuntimeToolRouter } from './runtime-tool-router';
import type { TargetAwareToolRouter } from './target-aware-tool-router';
import type { ExtensionState } from '../core/extension-state';
import type { CapabilityManifest } from '../core/runtime/capability-manifest';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

interface RuntimeStudioExecutionDependencies {
  readonly input: RuntimeStudioInput;
  readonly manifest: CapabilityManifest;
  readonly epochs: ToolInvocation['epochs'];
  readonly router: RuntimeToolRouter;
  readonly definitions?: readonly ToolDefinition[];
  readonly policy: RuntimePolicyV2Adapter;
  readonly transport: BackendRuntimeTransport;
  readonly stream: RuntimeEventStreamService;
  readonly observability: LocalObservabilityService;
  readonly journals: RunJournalService;
  readonly flagship: FlagshipDeliveryService;
  readonly state: ExtensionState;
  readonly configuration: () => RuntimeConfiguration;
  readonly targetRouter: (manifest: CapabilityManifest) => TargetAwareToolRouter;
  readonly fingerprint: (signal: AbortSignal) => Promise<RuntimeFingerprint>;
  readonly hash: (value: unknown) => string;
  readonly setActive: (runtime: RuntimeRunService | undefined, runId?: string) => void;
  /** Withdraw the run's approval prompts once it can no longer answer them. */
  readonly releaseApprovals: () => void;
}

interface RuntimeFingerprint {
  readonly account: string;
  readonly workspace: string;
  readonly target: string;
  readonly policy: string;
  readonly files: string;
  readonly gitHead: string;
}

const runtimeBudget = {
  maxModelTurns: 40,
  maxToolCalls: 100,
  maxToolRounds: 100,
  maxRepairAttempts: 1,
  maxRuntimeMs: 7_200_000,
  maxOutputBytes: 16_777_216,
  maxToolResultBytes: 1_048_576,
};

/**
 * Carries endings this side decided on to the panel, and nowhere else.
 *
 * The backend streams the whole step trail already, so forwarding everything
 * would show each tool twice. What it cannot stream is an ending decided here —
 * a denied tool, a cancel — because it does not know about it yet. Those went
 * into a sink that discarded them, so the panel was never told the run had
 * ended and reported "The ClawAI run ended without reporting a result" for what
 * was really a tool the user had refused.
 *
 * The panel is the only destination on purpose. The reducer's ledger belongs to
 * the backend and admits events strictly in sequence — `lastSequence + 1` —
 * while these carry the run service's own counter, an unrelated series. The
 * first version of this fix passed both to the same place and every run died
 * with "Runtime event sequence must advance from 40 to 41". Taking only a panel
 * callback here is what makes that mistake impossible to repeat.
 */
export function forwardLocalTerminals(
  toPanel: (event: RuntimeEvent) => void,
  onEnded: () => void,
): { publishBatch: (events: readonly RuntimeEvent[]) => void } {
  return {
    publishBatch: (events) => {
      for (const event of events) {
        if (!isRuntimeRunEnded(event.type)) continue;
        onEnded();
        toPanel(event);
      }
    },
  };
}

export async function executeRuntimeStudio(dependencies: RuntimeStudioExecutionDependencies) {
  const { input, manifest, epochs, router } = dependencies;
  // The caller supplies the catalog so it can describe roots that only exist
  // for this run, such as an approved external output folder.
  const definitions = dependencies.definitions ?? router.definitions();
  const traceId = input.requestId;
  const spanId = `span:${randomUUID()}`;
  const startedAt = new Date().toISOString();
  dependencies.observability.emit({
    name: 'runtime.v2.run',
    traceId,
    spanId,
    startedAt,
    status: 'unset',
    attributes: { threadId: input.threadId, toolCount: definitions.length },
  });
  // Whether the run reached an end state of its own, as opposed to the stream
  // being torn down under it by an error, a cancel, or a dropped connection.
  const outcome = { ended: false };
  const deliver = (event: RuntimeEvent): void => {
    if (isRuntimeRunEnded(event.type)) outcome.ended = true;
    dependencies.state.applyRuntimeEvent(event);
    input.onEvent(event);
  };
  const runtime = new RuntimeRunService({
    clock: { now: Date.now },
    currentEpochs: () => epochs,
    eventSink: forwardLocalTerminals(input.onEvent, () => {
      outcome.ended = true;
    }),
    executor: dependencies.targetRouter(manifest),
    policy: dependencies.policy,
    receiptId: () => `receipt:${randomUUID()}`,
    transport: dependencies.transport,
  });
  dependencies.setActive(runtime);
  try {
    const receipt = await runtime.start({
      runId: `runtime:${randomUUID()}`,
      turnId: `turn:${randomUUID()}`,
      threadId: input.threadId,
      clientRequestId: input.requestId,
      idempotencyKey: `request:${input.requestId}`,
      prompt: input.prompt,
      manifestHash: dependencies.hash(manifest),
      toolCatalogHash: dependencies.hash(definitions),
      provider: input.provider ?? 'AUTO',
      model: input.model ?? 'AUTO',
      epochs,
      definitions,
      budget: runtimeBudget,
    });
    dependencies.setActive(runtime, receipt.runId);
    const journal = new RuntimeJournalTracker(dependencies.journals);
    await journal.start({
      runId: receipt.runId,
      threadId: input.threadId,
      goal: input.prompt,
      policySnapshotHash: dependencies.hash({
        epochs,
        mode: dependencies.configuration().permissionMode,
      }),
      capabilitySnapshotHash: dependencies.hash(manifest),
      fingerprints: await dependencies.fingerprint(input.signal),
      budget: runtimeBudget,
      createdAt: startedAt,
    });
    await dependencies.stream.follow(
      receipt.runId,
      runtime,
      {
        onEvent: async (event) => {
          await journal.record(event);
          if (event.type === 'steering.received' && typeof event.payload.message === 'string') {
            dependencies.flagship.steerIfActive(event.payload.message);
          }
          deliver(event);
        },
      },
      input.signal,
    );
    emitCompletion(dependencies, traceId, spanId, startedAt, definitions.length, 'ok');
  } catch (error) {
    emitCompletion(dependencies, traceId, spanId, startedAt, definitions.length, 'error');
    throw error;
  } finally {
    // A run nobody is following any more has to be told to stop. Leaving it
    // meant the backend went on executing a run whose answer could no longer
    // reach anyone, and kept holding the one runtime slot — so the user's next
    // prompt queued behind a run that had already failed in front of them.
    // `cancel` is idempotent, so a run that ended on its own is left alone.
    if (!outcome.ended) await runtime.cancel().catch(() => undefined);
    // Whatever this run was still asking the user, it can no longer hear the
    // answer. An abandoned prompt is modal: it swallows every click aimed at
    // the composer, so the next message cannot be typed at all.
    dependencies.releaseApprovals();
    dependencies.setActive(undefined);
  }
}

function emitCompletion(
  dependencies: RuntimeStudioExecutionDependencies,
  traceId: string,
  spanId: string,
  startedAt: string,
  toolCount: number,
  status: 'ok' | 'error',
): void {
  dependencies.observability.emit({
    name: 'runtime.v2.run',
    traceId,
    spanId,
    startedAt,
    completedAt: new Date().toISOString(),
    status,
    attributes: { threadId: dependencies.input.threadId, toolCount },
  });
}
