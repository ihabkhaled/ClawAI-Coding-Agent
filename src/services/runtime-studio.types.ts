import type { DevelopmentServiceManager } from './development-service-manager';
import type { ElevationBrokerService } from './elevation-broker-service';
import type { EvidenceBundleService } from './evidence-bundle-service';
import type { FlagshipDeliveryService } from './flagship-delivery-service';
import type { IntegrationCoordinatorService } from './integration-coordinator-service';
import type { SubAgentCoordinatorService } from './sub-agent-coordinator-service';
import type { RuntimeEvent } from '../core/runtime/runtime-protocol.schemas';
import type { VscodeFileTransactionAdapter } from '../infrastructure/vscode-file-transaction-adapter';

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
