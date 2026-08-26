import { RUNTIME_EFFECT_APPROVAL_KIND } from '../core/approval-broker';
import { describeExternalOutputRoots } from '../core/runtime/external-output-catalog';
import { executableToolDefinitions } from '../core/runtime/runtime-executable-tools';

import type { ExternalOutputGrantStore } from './agent-coordinator.types';
import type { ConfigurationService } from './configuration-service';
import type { FlagshipDeliveryService } from './flagship-delivery-service';
import type { LocalObservabilityService } from './observability-service';
import type { RunJournalService } from './run-journal-service';
import type { RuntimeEventStreamService } from './runtime-event-stream-service';
import type { RuntimePolicyV2Adapter } from './runtime-policy-v2-adapter';
import type { RuntimeRunService } from './runtime-run-service';
import type { RuntimeStudioExecutionDependencies } from './runtime-studio-execution';
import type { RuntimeStudioInput } from './runtime-studio.types';
import type { RuntimeToolRouter } from './runtime-tool-router';
import type { TargetAwareToolRouter } from './target-aware-tool-router';
import type { ExtensionState } from '../core/extension-state';
import type { CapabilityManifest } from '../core/runtime/capability-manifest';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

export interface VscodeRuntimeExecutionHost {
  readonly epochs: ToolInvocation['epochs'];
  readonly router: RuntimeToolRouter;
  readonly externalOutputs: ExternalOutputGrantStore;
  readonly policy: RuntimePolicyV2Adapter;
  readonly transport: BackendRuntimeTransport;
  readonly stream: RuntimeEventStreamService;
  readonly observability: LocalObservabilityService;
  readonly journals: RunJournalService;
  readonly flagship: FlagshipDeliveryService;
  readonly state: ExtensionState;
  readonly configuration: ConfigurationService;
  routeTargets(manifest: CapabilityManifest): TargetAwareToolRouter;
  fingerprint(signal: AbortSignal): ReturnType<RuntimeStudioExecutionDependencies['fingerprint']>;
  setActiveRuntime(runtime: RuntimeRunService | undefined, runId?: string): void;
  cancelApprovals(kind: typeof RUNTIME_EFFECT_APPROVAL_KIND): void;
  hash(value: unknown): string;
}

export function vscodeRuntimeExecutionDependencies(
  host: VscodeRuntimeExecutionHost,
  input: RuntimeStudioInput,
  manifest: CapabilityManifest,
): RuntimeStudioExecutionDependencies {
  return {
    input,
    manifest,
    epochs: host.epochs,
    router: host.router,
    definitions: describeExternalOutputRoots(
      executableToolDefinitions(host.router.definitions(), manifest),
      host.externalOutputs.snapshot(),
    ),
    policy: host.policy,
    transport: host.transport,
    stream: host.stream,
    observability: host.observability,
    journals: host.journals,
    flagship: host.flagship,
    state: host.state,
    configuration: () => host.configuration.read(),
    targetRouter: (runtimeManifest) => host.routeTargets(runtimeManifest),
    fingerprint: (signal) => host.fingerprint(signal),
    hash: (value) => host.hash(value),
    setActive: (runtime, runId) => {
      host.setActiveRuntime(runtime, runId);
    },
    releaseApprovals: () => {
      host.cancelApprovals(RUNTIME_EFFECT_APPROVAL_KIND);
    },
  };
}
