import { createHash, randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { flagshipHostIdentityHash } from '../core/flagship-delivery';
import { browserToolDefinition } from '../infrastructure/browser-tool-executor';

import { TargetAwareToolRouter } from './target-aware-tool-router';

import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { ExecutionTargetRegistry } from './execution-target-registry';
import type { GitAgentService } from './git-agent-service';
import type { RuntimeRunService } from './runtime-run-service';
import type { RuntimeStudioInput } from './runtime-studio.types';
import type { RuntimeToolRouter } from './runtime-tool-router';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { ApprovalBroker } from '../core/approval-broker';
import type { BrowserScope } from '../core/browser-operation';
import type { ExtensionState } from '../core/extension-state';
import type { PolicyRequest } from '../core/policy-v2';
import type { CapabilityManifest } from '../core/runtime/capability-manifest';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';

/**
 * `notify` tells the run that asked for this effect that it is now waiting on a
 * human, and what the answer was. Without it the panel shows nothing at all
 * while the approval dialog is open, which reads as a hang.
 */
export async function approveRuntimeEffect(
  approvals: ApprovalBroker,
  request: PolicyRequest,
  signal?: AbortSignal,
  notify?: RuntimeStudioInput['onApproval'],
): Promise<boolean> {
  notify?.('waiting', request.effect);
  try {
    const approved = await approvals.request(
      {
        kind: 'runtimeEffect',
        title: vscode.l10n.t('Approve agent effect'),
        message: vscode.l10n.t('Review the exact scope before this operation runs.'),
        effect: {
          purpose: request.effect,
          target: request.scope.targetId,
          risk: request.risk,
          sideEffects: [request.effect],
          reversibility: request.reversible ? 'reversible' : 'irreversible',
        },
      },
      signal,
    );
    notify?.(approved ? 'approved' : 'rejected', request.effect);
    return approved;
  } catch (error: unknown) {
    notify?.('rejected', request.effect);
    throw error;
  }
}

export function runtimeBrowserScope(configuration: RuntimeConfiguration): BrowserScope {
  const origins = [configuration.backendUrl, configuration.frontendUrl].flatMap((value) =>
    value === undefined ? [] : [new URL(value).origin],
  );
  return {
    allowedOrigins: [...new Set(origins)],
    allowExternalNavigationWithApproval: true,
    allowDownloads: false,
    maxDownloadBytes: 104_857_600,
  };
}

export function runtimeFlagshipHostIdentityHash(
  state: ExtensionState,
  configuration: ConfigurationService,
  workspaceScope: WorkspaceScopeService,
  targetManifestHash: string | undefined,
): string {
  const workspaceId = workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing';
  const workspaceRoot =
    workspaceId === 'workspace:missing'
      ? 'workspace:missing'
      : workspaceScope.selectedFolder().uri.toString();
  const current = configuration.read();
  return flagshipHostIdentityHash({
    accountId: state.snapshot.user?.id ?? 'account:anonymous',
    workspaceId,
    workspaceRoot,
    targetIdentity: targetManifestHash ?? 'target:unavailable',
    policyIdentity: [
      current.backendUrl,
      current.permissionMode,
      String(vscode.workspace.isTrusted),
    ].join('|'),
  });
}

interface RuntimeFingerprintDependencies {
  readonly state: ExtensionState;
  readonly configuration: ConfigurationService;
  readonly workspaceScope: WorkspaceScopeService;
  readonly git: GitAgentService;
}

export async function runtimeFingerprint(
  dependencies: RuntimeFingerprintDependencies,
  epochs: {
    readonly account: number;
    readonly workspace: number;
    readonly target: number;
    readonly policy: number;
  },
  signal: AbortSignal,
) {
  const workspace = dependencies.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing';
  let files = hashRuntimeValue({ workspace, unavailable: true });
  let gitHead = '';
  try {
    const receipt = await dependencies.git.execute(
      { rootKey: workspace, operation: 'status' },
      signal,
    );
    files = receipt.afterWorkingTreeHash;
    gitHead = receipt.afterHead ?? '';
  } catch {
    // Non-Git workspaces retain a stable, explicit unavailable fingerprint.
  }
  return {
    account: dependencies.state.snapshot.user?.id ?? 'account:anonymous',
    workspace,
    target: 'target:workspace',
    policy: hashRuntimeValue({ epochs, mode: dependencies.configuration.read().permissionMode }),
    files,
    gitHead,
  };
}

export function hashRuntimeValue(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

interface TargetRouterDependencies {
  readonly manifest: CapabilityManifest;
  readonly targets: ExecutionTargetRegistry;
  readonly router: RuntimeToolRouter;
  readonly currentManifestHash: string | undefined;
  readonly currentTargetEpoch: number;
}

export function buildRuntimeTargetRouter(dependencies: TargetRouterDependencies): {
  readonly router: TargetAwareToolRouter;
  readonly manifestHash: string;
  readonly targetEpoch: number;
} {
  const manifestHash = hashRuntimeValue(dependencies.manifest.targets);
  const targetEpoch =
    dependencies.currentManifestHash !== undefined &&
    dependencies.currentManifestHash !== manifestHash
      ? dependencies.currentTargetEpoch + 1
      : dependencies.currentTargetEpoch;
  const delegates = new Map<string, RuntimeToolRouter>();
  for (const target of dependencies.manifest.targets) {
    dependencies.targets.register(
      target,
      {
        // Execution readiness (`target.online`) proves nothing about internet reachability.
        // Without a probe the only truthful claim is that the workspace itself is reachable;
        // asserting 'internet' here would fabricate research capability the host has not proven.
        networkReachability: 'workspace-only',
        browserAvailability: target.capabilities.includes(browserToolDefinition.name)
          ? 'visible-local'
          : 'none',
      },
      targetEpoch,
    );
    delegates.set(target.id, dependencies.router);
  }
  return {
    router: new TargetAwareToolRouter(dependencies.targets, delegates),
    manifestHash,
    targetEpoch,
  };
}

export async function steerRuntime(
  transport: BackendRuntimeTransport,
  runtime: RuntimeRunService | undefined,
  runId: string | undefined,
  epochs: ToolInvocation['epochs'],
  message: string,
): Promise<void> {
  if (runtime === undefined || runId === undefined) throw new Error('No Runtime V2 run is active');
  const steeringId = `steering:${randomUUID()}`;
  await transport.steer(
    runId,
    {
      schemaVersion: '2.0',
      steeringId,
      runId,
      sequence: runtime.snapshot.runs[runId]?.steeringNextSequence ?? 0,
      idempotencyKey: `steering-key:${randomUUID()}`,
      message,
      epochs,
      receivedAt: new Date().toISOString(),
    },
    new AbortController().signal,
  );
}
