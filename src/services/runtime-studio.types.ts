import type { AgentTaskService } from './agent-task-service';
import type { DevelopmentServiceManager } from './development-service-manager';
import type { ElevationBrokerService } from './elevation-broker-service';
import type { EvidenceBundleService } from './evidence-bundle-service';
import type { FileTransactionService } from './file-transaction-service';
import type { FindingsService } from './findings-service';
import type { FlagshipDeliveryService } from './flagship-delivery-service';
import type { IntegrationCoordinatorService } from './integration-coordinator-service';
import type { ProcessSupervisorService } from './process-supervisor-service';
import type { RunJournalService } from './run-journal-service';
import type { SubAgentCoordinatorService } from './sub-agent-coordinator-service';
import type { WebResearchPort } from './web-research.types';
import type { WorkspaceIntelligenceService } from './workspace-intelligence-service';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { AdvisorPort } from '../infrastructure/advisor-tool-executor.types';
import type { UserQuestionPort } from '../infrastructure/ask-user-tool-executor';
import type { ConversationEndPort } from '../infrastructure/end-conversation-tool-executor';
import type { RunGoalPort } from '../infrastructure/goal-tool-executor.types';
import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';
import type { DeliveredArtifactSink } from '../infrastructure/vscode-filesystem-tool-executor';

export interface RuntimeStudioAdvancedTools {
  readonly evidence: EvidenceBundleService;
  readonly files: VscodeFileTransactionAdapter;
  readonly developmentServices: DevelopmentServiceManager;
  readonly subAgents: SubAgentCoordinatorService;
  readonly integration: IntegrationCoordinatorService;
  readonly flagship: FlagshipDeliveryService;
  readonly elevation: ElevationBrokerService;
  readonly activeRunId: () => string;
}

export interface RuntimeStudioWorkspaceTools {
  readonly files: VscodeFileTransactionAdapter;
  readonly transactions: FileTransactionService;
  readonly artifacts: DeliveredArtifactSink;
  readonly processes: ProcessSupervisorService;
  readonly accountId: () => string;
}

export interface RuntimeStudioAnalysisTools {
  readonly questions: UserQuestionPort;
  readonly conversationEnd: ConversationEndPort;
  readonly intelligence: WorkspaceIntelligenceService;
  readonly transactions: FileTransactionService;
  readonly tasks: AgentTaskService;
  readonly journals: RunJournalService;
  readonly research: WebResearchPort;
  readonly advisor: AdvisorPort;
  readonly goal: RunGoalPort;
  /** Where an imported scanner report is recorded, beside a reviewer's own. */
  readonly findings: FindingsService;
  /** The epoch generation a loaded workflow must be re-stamped with. */
  readonly currentEpochs: () => ToolInvocation['epochs'];
  readonly files: VscodeFileTransactionAdapter;
}

export type RuntimeApprovalPhase = 'waiting' | 'approved' | 'rejected';

export interface RuntimeStudioInput {
  readonly prompt: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly provider?: string;
  readonly model?: string;
  readonly signal: AbortSignal;
  readonly onEvent: (event: RuntimeEvent) => void;
  /**
   * A run blocked on the approval dialog looks identical to a run that has
   * hung. Only one Runtime V2 run is active per extension host, so the studio
   * can attribute an approval to the request that asked for it.
   */
  readonly onApproval?: (phase: RuntimeApprovalPhase, effect: string) => void;
}
