import { randomUUID } from 'node:crypto';

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
  const runtime = new RuntimeRunService({
    clock: { now: Date.now },
    currentEpochs: () => epochs,
    eventSink: { publishBatch: () => undefined },
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
          dependencies.state.applyRuntimeEvent(event);
          input.onEvent(event);
        },
      },
      input.signal,
    );
    emitCompletion(dependencies, traceId, spanId, startedAt, definitions.length, 'ok');
  } catch (error) {
    emitCompletion(dependencies, traceId, spanId, startedAt, definitions.length, 'error');
    throw error;
  } finally {
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
