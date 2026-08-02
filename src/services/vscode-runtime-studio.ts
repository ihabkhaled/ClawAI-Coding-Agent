import { createHash, randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { BackendRuntimeTransport } from '../infrastructure/backend-runtime-transport';
import {
  BrowserToolExecutor,
  browserToolDefinition,
} from '../infrastructure/browser-tool-executor';
import {
  ContainerToolExecutor,
  containerToolDefinition,
} from '../infrastructure/container-tool-executor';
import {
  DatabaseToolExecutor,
  databaseToolDefinition,
} from '../infrastructure/database-tool-executor';
import { DeterministicEvidenceArchive } from '../infrastructure/deterministic-evidence-archive';
import { DevelopmentServiceDiscovery } from '../infrastructure/development-service-discovery';
import {
  DevelopmentServiceToolExecutor,
  developmentServiceToolDefinition,
} from '../infrastructure/development-service-tool-executor';
import {
  EvidenceToolExecutor,
  evidenceToolDefinition,
} from '../infrastructure/evidence-tool-executor';
import { GitToolExecutor, gitToolDefinition } from '../infrastructure/git-tool-executor';
import {
  IntelligenceToolExecutor,
  intelligenceToolDefinition,
} from '../infrastructure/intelligence-tool-executor';
import {
  PlanningToolExecutor,
  planningToolDefinition,
} from '../infrastructure/planning-tool-executor';
import { PlaywrightBrowserDriver } from '../infrastructure/playwright-browser-driver';
import {
  ProcessSupervisorToolExecutor,
  processSupervisorToolDefinition,
} from '../infrastructure/process-supervisor-tool-executor';
import {
  QualityToolExecutor,
  qualityToolDefinition,
} from '../infrastructure/quality-tool-executor';
import {
  RunJournalToolExecutor,
  runJournalToolDefinition,
} from '../infrastructure/run-journal-tool-executor';
import {
  StructuredCommandToolExecutor,
  structuredCommandToolDefinition,
} from '../infrastructure/structured-command-tool-executor';
import {
  SocketPortInspector,
  VscodeDevelopmentServiceAdapter,
  VscodeDevelopmentServiceReadiness,
  VscodeServiceCheckpointStore,
} from '../infrastructure/vscode-development-service-adapter';
import { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';
import {
  VscodeFilesystemToolExecutor,
  workspaceFilesystemToolDefinition,
} from '../infrastructure/vscode-filesystem-tool-executor';
import { VscodeIntelligenceIndex } from '../infrastructure/vscode-intelligence-index';
import {
  VscodeRunJournalKeyStore,
  VscodeRunJournalStorage,
} from '../infrastructure/vscode-run-journal-adapter';

import { BrowserControllerService } from './browser-controller-service';
import { ContainerEngineService } from './container-engine-service';
import { DatabaseProfileVault } from './database-profile-vault';
import {
  DatabaseWorkbenchService,
  DocumentCliDatabaseAdapter,
  SqlCliDatabaseAdapter,
} from './database-workbench-service';
import { DevelopmentServiceManager } from './development-service-manager';
import { EvidenceBundleService } from './evidence-bundle-service';
import { ExecutionTargetRegistry } from './execution-target-registry';
import { FileTransactionService } from './file-transaction-service';
import { GitAgentService } from './git-agent-service';
import { ProcessSupervisorService } from './process-supervisor-service';
import { ProjectPolicyService } from './project-policy-service';
import { RunJournalService } from './run-journal-service';
import { RuntimeEventStreamService } from './runtime-event-stream-service';
import { RuntimePolicyV2Adapter } from './runtime-policy-v2-adapter';
import { RuntimeRunService } from './runtime-run-service';
import { RuntimeToolRouter } from './runtime-tool-router';
import { ServerReadinessService } from './server-readiness-service';
import { TargetAwareToolRouter } from './target-aware-tool-router';
import { WorkspaceIntelligenceService } from './workspace-intelligence-service';

import type { ExternalOutputGrantStore } from './agent-coordinator.types';
import type { ConfigurationService, RuntimeConfiguration } from './configuration-service';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { BackendClient } from '../backend/backend-client';
import type { ApprovalBroker } from '../core/approval-broker';
import type { BrowserScope } from '../core/browser-operation';
import type { ExtensionState } from '../core/extension-state';
import type { PolicyRequest } from '../core/policy-v2';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';

export interface RuntimeStudioInput {
  readonly prompt: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: RuntimeEvent) => void;
}

export class VscodeRuntimeStudio implements vscode.Disposable {
  private readonly files: VscodeFileTransactionAdapter;
  private readonly transactions: FileTransactionService;
  private readonly processes = new ProcessSupervisorService();
  private readonly transport: BackendRuntimeTransport;
  private readonly stream: RuntimeEventStreamService;
  private readonly router: RuntimeToolRouter;
  private readonly targets: ExecutionTargetRegistry;
  private readonly policy: RuntimePolicyV2Adapter;
  private readonly intelligenceIndex: VscodeIntelligenceIndex;
  private active: RuntimeRunService | undefined;
  private activeRunId: string | undefined;
  private targetManifestHash: string | undefined;
  private epochs: ToolInvocation['epochs'] = { account: 0, workspace: 0, target: 0, policy: 0 };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: ExtensionState,
    private readonly configuration: ConfigurationService,
    private readonly workspaceScope: WorkspaceScopeService,
    externalOutputs: ExternalOutputGrantStore,
    approvals: ApprovalBroker,
    backend: () => BackendClient,
  ) {
    this.files = new VscodeFileTransactionAdapter(externalOutputs);
    this.transactions = new FileTransactionService(this.files);
    this.transport = new BackendRuntimeTransport(backend);
    this.stream = new RuntimeEventStreamService(this.transport);
    this.targets = new ExecutionTargetRegistry({
      cancelTarget: async () => this.cancel(),
      cleanupOwnedProcesses: () => {
        this.processes.dispose();
        return Promise.resolve();
      },
    });
    this.policy = new RuntimePolicyV2Adapter(
      {
        accountId: () => this.state.snapshot.user?.id ?? 'account:anonymous',
        backendOrigin: () => this.configuration.read().backendUrl,
        workspaceId: () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
        workspaceRoot: () => this.workspaceScope.selectedFolder().uri.toString(),
        mode: () => this.configuration.read().permissionMode,
        workspaceTrusted: () => vscode.workspace.isTrusted,
        userPresent: () => vscode.window.state.focused,
        approve: (request, signal) => this.approveEffect(approvals, request, signal),
      },
      new ProjectPolicyService(this.workspaceScope),
    );
    const git = new GitAgentService(this.files, (diff, hash, signal) =>
      approvals.request(
        {
          kind: 'runtimeEffect',
          title: vscode.l10n.t('Approve staged Git changes'),
          message: vscode.l10n.t('Review the exact staged diff before creating this commit.'),
          effect: {
            purpose: vscode.l10n.t('Create a reviewed Git commit'),
            target: hash,
            risk: 'R3',
            sideEffects: [vscode.l10n.t('The staged repository state will receive a new commit.')],
            reversibility: 'partially-reversible',
            sanitizedPreview: diff,
          },
        },
        signal,
      ),
    );
    const containers = new ContainerEngineService(
      this.files,
      () => this.state.snapshot.user?.id ?? 'account:anonymous',
      () => this.activeRunId ?? 'runtime:inactive',
      () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
    );
    const profiles = new DatabaseProfileVault(context.secrets, context.workspaceState);
    const databases = new DatabaseWorkbenchService(
      profiles,
      [new SqlCliDatabaseAdapter(), new DocumentCliDatabaseAdapter()],
      {
        productionWritesEnabled: () => false,
        approveWrite: (profile, classification, statementHash, backupAcknowledged, signal) =>
          approvals.request(
            {
              kind: 'runtimeEffect',
              title: vscode.l10n.t('Approve database change'),
              message: vscode.l10n.t('Review this database effect before execution.'),
              effect: {
                purpose: `${classification} database operation`,
                target: `${profile.label} · ${profile.environment}`,
                risk: profile.environment === 'production' ? 'R4' : 'R3',
                sideEffects: [
                  backupAcknowledged ? 'Backup acknowledged' : 'No backup acknowledgement',
                ],
                reversibility: 'partially-reversible',
                sanitizedPreview: statementHash,
              },
            },
            signal,
          ),
      },
    );
    const browserDriver = new PlaywrightBrowserDriver(
      this.files,
      vscode.Uri.joinPath(context.globalStorageUri, 'browser-evidence').fsPath,
    );
    const browser = new BrowserControllerService(
      browserDriver,
      () => this.browserScope(this.configuration.read()),
      {
        approveOrigin: (origin, signal) =>
          approvals.request(
            {
              kind: 'runtimeEffect',
              title: vscode.l10n.t('Approve browser navigation'),
              message: vscode.l10n.t('This origin is outside the current browser scope.'),
              effect: {
                purpose: vscode.l10n.t('Navigate the isolated browser'),
                target: origin,
                risk: 'R2',
                sideEffects: [vscode.l10n.t('The website may receive the browser request.')],
                reversibility: 'reversible',
              },
            },
            signal,
          ),
      },
    );
    const readiness = new ServerReadinessService(
      () => this.browserScope(this.configuration.read()),
      { isRunning: () => false, recentLogs: () => '' },
    );
    this.intelligenceIndex = new VscodeIntelligenceIndex(
      this.files,
      () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
    );
    const intelligence = new WorkspaceIntelligenceService(this.intelligenceIndex);
    const journals = new RunJournalService(
      new VscodeRunJournalStorage(context.globalStorageUri),
      new VscodeRunJournalKeyStore(context.secrets),
    );
    const evidence = new EvidenceBundleService(new DeterministicEvidenceArchive());
    const developmentServices = new DevelopmentServiceManager(
      new VscodeDevelopmentServiceAdapter(
        this.processes,
        containers,
        this.files,
        () => this.state.snapshot.user?.id ?? 'account:anonymous',
        () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
      ),
      new VscodeDevelopmentServiceReadiness(readiness),
      new SocketPortInspector(),
      new VscodeServiceCheckpointStore(context.workspaceState),
    );
    const registrations = [
      {
        definition: workspaceFilesystemToolDefinition,
        executor: new VscodeFilesystemToolExecutor(this.files, this.transactions),
      },
      {
        definition: structuredCommandToolDefinition,
        executor: new StructuredCommandToolExecutor(this.files),
      },
      {
        definition: processSupervisorToolDefinition,
        executor: new ProcessSupervisorToolExecutor(
          this.processes,
          () => this.state.snapshot.user?.id ?? 'account:anonymous',
          this.files,
        ),
      },
      { definition: gitToolDefinition, executor: new GitToolExecutor(git) },
      { definition: containerToolDefinition, executor: new ContainerToolExecutor(containers) },
      {
        definition: databaseToolDefinition,
        executor: new DatabaseToolExecutor(profiles, databases, this.files),
      },
      { definition: qualityToolDefinition, executor: new QualityToolExecutor(this.files) },
      { definition: browserToolDefinition, executor: new BrowserToolExecutor(browser, readiness) },
      {
        definition: intelligenceToolDefinition,
        executor: new IntelligenceToolExecutor(intelligence),
      },
      { definition: planningToolDefinition, executor: new PlanningToolExecutor(this.transactions) },
      { definition: runJournalToolDefinition, executor: new RunJournalToolExecutor(journals) },
      {
        definition: evidenceToolDefinition,
        executor: new EvidenceToolExecutor(evidence, this.files),
      },
      {
        definition: developmentServiceToolDefinition,
        executor: new DevelopmentServiceToolExecutor(
          new DevelopmentServiceDiscovery(this.files),
          developmentServices,
        ),
      },
    ];
    this.router = new RuntimeToolRouter(registrations, this.policy);
  }

  async execute(input: RuntimeStudioInput): Promise<void> {
    if (this.active !== undefined)
      throw new Error('A Runtime V2 run is already active in this extension host');
    const manifest = this.state.snapshot.runtime.capabilityManifest;
    if (manifest === undefined) throw new Error('Runtime capability manifest is unavailable');
    const definitions = this.router.definitions();
    const runtime = new RuntimeRunService({
      clock: { now: Date.now },
      currentEpochs: () => this.epochs,
      // The backend stream owns user-visible event ordering. Local dispatch events still update
      // RuntimeRunService atomically, but publishing them here would apply each lifecycle twice.
      eventSink: { publishBatch: () => undefined },
      executor: this.targetRouter(manifest),
      policy: this.policy,
      receiptId: () => `receipt:${randomUUID()}`,
      transport: this.transport,
    });
    this.active = runtime;
    try {
      const receipt = await runtime.start({
        runId: `runtime:${randomUUID()}`,
        turnId: `turn:${randomUUID()}`,
        threadId: input.threadId,
        clientRequestId: input.requestId,
        idempotencyKey: `request:${input.requestId}`,
        prompt: input.prompt,
        manifestHash: this.hash(manifest),
        toolCatalogHash: this.hash(definitions),
        provider: input.provider ?? 'AUTO',
        model: input.model ?? 'AUTO',
        epochs: this.epochs,
        definitions,
        budget: {
          maxModelTurns: 40,
          maxToolCalls: 100,
          maxToolRounds: 100,
          maxRepairAttempts: 1,
          maxRuntimeMs: 7_200_000,
          maxOutputBytes: 16_777_216,
          maxToolResultBytes: 1_048_576,
        },
      });
      this.activeRunId = receipt.runId;
      await this.stream.follow(
        receipt.runId,
        runtime,
        {
          onEvent: (event) => {
            this.state.applyRuntimeEvent(event);
            input.onEvent(event);
          },
        },
        input.signal,
      );
    } finally {
      this.active = undefined;
      this.activeRunId = undefined;
    }
  }

  async cancel(): Promise<void> {
    await this.active?.cancel();
  }

  invalidateAccount(): void {
    this.epochs = { ...this.epochs, account: this.epochs.account + 1 };
    void this.cancel();
  }

  invalidateWorkspace(): void {
    this.epochs = { ...this.epochs, workspace: this.epochs.workspace + 1 };
    void this.cancel();
  }

  dispose(): void {
    void this.cancel();
    this.processes.dispose();
    this.intelligenceIndex.dispose();
  }

  private approveEffect(
    approvals: ApprovalBroker,
    request: PolicyRequest,
    signal?: AbortSignal,
  ): Promise<boolean> {
    return approvals.request(
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
  }

  private browserScope(configuration: RuntimeConfiguration): BrowserScope {
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

  private targetRouter(
    manifest: NonNullable<ExtensionState['snapshot']['runtime']['capabilityManifest']>,
  ): TargetAwareToolRouter {
    const targetManifestHash = this.hash(manifest.targets);
    if (this.targetManifestHash !== undefined && this.targetManifestHash !== targetManifestHash) {
      this.epochs = { ...this.epochs, target: this.epochs.target + 1 };
    }
    this.targetManifestHash = targetManifestHash;
    const delegates = new Map<string, RuntimeToolRouter>();
    for (const target of manifest.targets) {
      this.targets.register(
        target,
        {
          networkReachability: target.online ? 'internet' : 'offline',
          browserAvailability: target.capabilities.includes(browserToolDefinition.name)
            ? 'visible-local'
            : 'none',
        },
        this.epochs.target,
      );
      delegates.set(target.id, this.router);
    }
    return new TargetAwareToolRouter(this.targets, delegates);
  }

  private hash(value: unknown): string {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  }
}
