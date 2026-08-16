import * as vscode from 'vscode';

import { RUNTIME_EFFECT_APPROVAL_KIND } from '../core/approval-broker';
import { describeExternalOutputRoots } from '../core/runtime/external-output-catalog';
import { executableToolDefinitions } from '../core/runtime/runtime-executable-tools';
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
import { VscodeElevationVerificationAdapter } from '../infrastructure/elevation-tool-executor';
import { VscodeFlagshipCheckpointStore } from '../infrastructure/flagship-tool-executor';
import { GitToolExecutor, gitToolDefinition } from '../infrastructure/git-tool-executor';
import {
  RuntimeIntegrationGitAdapter,
  RuntimeIntegrationQualityAdapter,
} from '../infrastructure/integration-tool-executor';
import {
  IntelligenceToolExecutor,
  intelligenceToolDefinition,
} from '../infrastructure/intelligence-tool-executor';
import { PackagedNativeElevationAdapter } from '../infrastructure/native-elevation-adapter';
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
import { VscodeObservabilitySink } from '../infrastructure/vscode-observability-sink';
import {
  VscodeRunJournalKeyStore,
  VscodeRunJournalStorage,
} from '../infrastructure/vscode-run-journal-adapter';
import { VscodeRuntimeBindingStore } from '../infrastructure/vscode-runtime-binding-store';
import { VscodeSubAgentDiagnosticsSink } from '../infrastructure/vscode-sub-agent-diagnostics-sink';
import { VscodeSubAgentWorktreeAdapter } from '../infrastructure/vscode-sub-agent-worktree-adapter';

import { BrowserControllerService } from './browser-controller-service';
import { ContainerEngineService } from './container-engine-service';
import { DatabaseProfileVault } from './database-profile-vault';
import {
  DatabaseWorkbenchService,
  DocumentCliDatabaseAdapter,
  SqlCliDatabaseAdapter,
} from './database-workbench-service';
import { DevelopmentServiceManager } from './development-service-manager';
import { ElevationBrokerService } from './elevation-broker-service';
import { EvidenceBundleService } from './evidence-bundle-service';
import { ExecutionTargetRegistry } from './execution-target-registry';
import { FileLeaseManager } from './file-lease-manager';
import { FileTransactionService } from './file-transaction-service';
import { FlagshipDeliveryService } from './flagship-delivery-service';
import { GitAgentService } from './git-agent-service';
import { IntegrationCoordinatorService } from './integration-coordinator-service';
import { LocalObservabilityService } from './observability-service';
import { ProcessSupervisorService } from './process-supervisor-service';
import { ProjectPolicyService } from './project-policy-service';
import { RunJournalService } from './run-journal-service';
import { RuntimeEventStreamService } from './runtime-event-stream-service';
import {
  CoordinatedFlagshipSubAgentPort,
  RuntimeFlagshipStageAdapter,
} from './runtime-flagship-stage-adapter';
import { RuntimePolicyV2Adapter } from './runtime-policy-v2-adapter';
import { executeRuntimeStudio } from './runtime-studio-execution';
import {
  approveRuntimeEffect,
  buildRuntimeTargetRouter,
  hashRuntimeValue,
  runtimeBrowserScope,
  runtimeFingerprint,
  steerRuntime,
} from './runtime-studio-helpers';
import { advancedToolRegistrations } from './runtime-studio-registrations';
import { RuntimeSubAgentExecutor } from './runtime-sub-agent-executor';
import { RuntimeToolRouter } from './runtime-tool-router';
import { ServerReadinessService } from './server-readiness-service';
import { SubAgentCoordinatorService } from './sub-agent-coordinator-service';
import { SubAgentWorktreeService } from './sub-agent-worktree-service';
import { WorkspaceIntelligenceService } from './workspace-intelligence-service';

import type { ExternalOutputGrantStore } from './agent-coordinator.types';
import type { ConfigurationService } from './configuration-service';
import type { RuntimeRunService } from './runtime-run-service';
import type { RuntimeStudioInput } from './runtime-studio.types';
import type { TargetAwareToolRouter } from './target-aware-tool-router';
import type { WorkspaceScopeService } from './workspace-scope-service';
import type { BackendClient } from '../backend/backend-client';
import type { ApprovalBroker } from '../core/approval-broker';
import type { ExtensionState } from '../core/extension-state';
import type { CapabilityManifest } from '../core/runtime/capability-manifest';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { OutputLogger } from '../infrastructure/output-logger';

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
  private readonly observability: LocalObservabilityService;
  private readonly flagship: FlagshipDeliveryService;
  private readonly git: GitAgentService;
  private readonly journals: RunJournalService;
  private active: RuntimeRunService | undefined;
  private activeRunId: string | undefined;
  private activeInput: RuntimeStudioInput | undefined;
  private targetManifestHash: string | undefined;
  private epochs: ToolInvocation['epochs'] = { account: 0, workspace: 0, target: 0, policy: 0 };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly state: ExtensionState,
    private readonly configuration: ConfigurationService,
    private readonly workspaceScope: WorkspaceScopeService,
    private readonly externalOutputs: ExternalOutputGrantStore,
    private readonly approvals: ApprovalBroker,
    backend: () => BackendClient,
    logger: OutputLogger,
  ) {
    this.files = new VscodeFileTransactionAdapter(externalOutputs);
    this.transactions = new FileTransactionService(this.files);
    this.transport = new BackendRuntimeTransport(
      backend,
      new VscodeRuntimeBindingStore(context.workspaceState),
    );
    this.stream = new RuntimeEventStreamService(this.transport);
    this.observability = new LocalObservabilityService(new VscodeObservabilitySink(logger));
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
        approve: (request, signal) =>
          approveRuntimeEffect(approvals, request, signal, this.activeInput?.onApproval),
      },
      new ProjectPolicyService(this.workspaceScope),
    );
    this.git = new GitAgentService(this.files, (diff, hash, signal) =>
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
      () => runtimeBrowserScope(this.configuration.read()),
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
      () => runtimeBrowserScope(this.configuration.read()),
      {
        evidence: (sessionId, runId) => this.processes.readinessEvidence(sessionId, runId),
      },
    );
    this.intelligenceIndex = new VscodeIntelligenceIndex(
      this.files,
      () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
    );
    const intelligence = new WorkspaceIntelligenceService(this.intelligenceIndex);
    this.journals = new RunJournalService(
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
    const runtimeSubAgent = new RuntimeSubAgentExecutor({
      backend,
      currentEpochs: () => this.epochs,
      definitions: () => this.router.definitions(),
      executor: { execute: (invocation, signal) => this.router.execute(invocation, signal) },
      policy: this.policy,
      stream: this.stream,
      transport: this.transport,
    });
    const subAgentWorktreeAdapter = new VscodeSubAgentWorktreeAdapter(
      this.files,
      vscode.Uri.joinPath(context.globalStorageUri, 'agent-worktrees').fsPath,
      () => this.workspaceScope.snapshot().selectedFolderKey ?? 'workspace:missing',
    );
    const subAgentWorktrees = new SubAgentWorktreeService(subAgentWorktreeAdapter);
    const subAgents = new SubAgentCoordinatorService(
      runtimeSubAgent,
      new FileLeaseManager(),
      () => this.epochs,
      new VscodeSubAgentDiagnosticsSink(logger, context.globalStorageUri),
      subAgentWorktrees,
    );
    const quality = new QualityToolExecutor(this.files);
    const integration = new IntegrationCoordinatorService(
      new RuntimeIntegrationGitAdapter(this.git, subAgentWorktreeAdapter),
      new RuntimeIntegrationQualityAdapter(quality),
    );
    this.flagship = new FlagshipDeliveryService(
      new RuntimeFlagshipStageAdapter(
        new CoordinatedFlagshipSubAgentPort(subAgents),
        () => this.epochs,
        integration,
      ),
      new VscodeFlagshipCheckpointStore(context.workspaceState),
      { update: () => undefined },
    );
    const elevation = new ElevationBrokerService(
      new PackagedNativeElevationAdapter(
        vscode.Uri.joinPath(context.extensionUri, 'resources', 'elevation-helper.mjs').fsPath,
      ),
      {
        confirm: (recipe, signal) =>
          approvals.request(
            {
              kind: 'runtimeEffect',
              title: vscode.l10n.t('Approve administrator operation'),
              message: recipe.explanation,
              effect: {
                purpose: recipe.recipeId,
                target: `${recipe.command.executable} ${recipe.command.arguments.join(' ')}`,
                risk: 'R4',
                sideEffects: [
                  vscode.l10n.t('Your operating system will show native administrator consent.'),
                ],
                reversibility: 'irreversible',
              },
            },
            signal,
          ),
      },
      new VscodeElevationVerificationAdapter(),
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
      { definition: gitToolDefinition, executor: new GitToolExecutor(this.git) },
      { definition: containerToolDefinition, executor: new ContainerToolExecutor(containers) },
      {
        definition: databaseToolDefinition,
        executor: new DatabaseToolExecutor(profiles, databases, this.files),
      },
      { definition: qualityToolDefinition, executor: quality },
      { definition: browserToolDefinition, executor: new BrowserToolExecutor(browser, readiness) },
      {
        definition: intelligenceToolDefinition,
        executor: new IntelligenceToolExecutor(intelligence),
      },
      { definition: planningToolDefinition, executor: new PlanningToolExecutor(this.transactions) },
      { definition: runJournalToolDefinition, executor: new RunJournalToolExecutor(this.journals) },
      ...advancedToolRegistrations({
        evidence,
        files: this.files,
        developmentServices,
        subAgents,
        integration,
        flagship: this.flagship,
        elevation,
        activeRunId: () => this.activeRunId ?? 'runtime:inactive',
      }),
    ];
    this.router = new RuntimeToolRouter(registrations, this.policy);
  }

  async execute(input: RuntimeStudioInput): Promise<void> {
    if (this.active !== undefined)
      throw new Error('A Runtime V2 run is already active in this extension host');
    const manifest = this.state.snapshot.runtime.capabilityManifest;
    if (manifest === undefined) throw new Error('Runtime capability manifest is unavailable');
    // The approval callback belongs to whichever run is executing; only one can
    // be active at a time, which is what makes the attribution exact.
    this.activeInput = input;
    try {
      await this.runStudio(input, manifest);
    } finally {
      this.activeInput = undefined;
    }
  }

  private routeTargets(runtimeManifest: CapabilityManifest): TargetAwareToolRouter {
    const result = buildRuntimeTargetRouter({
      manifest: runtimeManifest,
      targets: this.targets,
      router: this.router,
      currentManifestHash: this.targetManifestHash,
      currentTargetEpoch: this.epochs.target,
    });
    this.targetManifestHash = result.manifestHash;
    this.epochs = { ...this.epochs, target: result.targetEpoch };
    return result.router;
  }

  private async runStudio(input: RuntimeStudioInput, manifest: CapabilityManifest): Promise<void> {
    await executeRuntimeStudio({
      input,
      manifest,
      epochs: this.epochs,
      router: this.router,
      definitions: describeExternalOutputRoots(
        executableToolDefinitions(this.router.definitions(), manifest),
        this.externalOutputs.snapshot(),
      ),
      policy: this.policy,
      transport: this.transport,
      stream: this.stream,
      observability: this.observability,
      journals: this.journals,
      flagship: this.flagship,
      state: this.state,
      configuration: () => this.configuration.read(),
      targetRouter: (runtimeManifest) => this.routeTargets(runtimeManifest),
      fingerprint: (signal) =>
        runtimeFingerprint(
          {
            state: this.state,
            configuration: this.configuration,
            workspaceScope: this.workspaceScope,
            git: this.git,
          },
          this.epochs,
          signal,
        ),
      hash: hashRuntimeValue,
      setActive: (runtime, runId) => {
        this.active = runtime;
        this.activeRunId = runId;
      },
      releaseApprovals: () => {
        this.approvals.cancelKind(RUNTIME_EFFECT_APPROVAL_KIND);
      },
    });
  }

  async cancel(): Promise<void> {
    await this.active?.cancel();
  }

  pause(): void {
    this.flagship.pause();
  }

  resume(): void {
    this.flagship.resume();
  }

  async steer(message: string): Promise<void> {
    await steerRuntime(this.transport, this.active, this.activeRunId, this.epochs, message);
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
}
