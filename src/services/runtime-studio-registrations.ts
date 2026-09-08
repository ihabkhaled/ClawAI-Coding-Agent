import {
  AskUserToolExecutor,
  askUserToolDefinition,
} from '../infrastructure/ask-user-tool-executor';
import { DevelopmentServiceDiscovery } from '../infrastructure/development-service-discovery';
import {
  DevelopmentServiceToolExecutor,
  developmentServiceToolDefinition,
} from '../infrastructure/development-service-tool-executor';
import {
  ElevationToolExecutor,
  elevationToolDefinition,
} from '../infrastructure/elevation-tool-executor';
import {
  EvidenceToolExecutor,
  evidenceToolDefinition,
} from '../infrastructure/evidence-tool-executor';
import {
  FlagshipToolExecutor,
  flagshipToolDefinition,
} from '../infrastructure/flagship-tool-executor';
import {
  IntegrationToolExecutor,
  integrationToolDefinition,
} from '../infrastructure/integration-tool-executor';
import {
  IntelligenceToolExecutor,
  intelligenceToolDefinition,
} from '../infrastructure/intelligence-tool-executor';
import {
  PlanningToolExecutor,
  planningToolDefinition,
} from '../infrastructure/planning-tool-executor';
import {
  RunJournalToolExecutor,
  runJournalToolDefinition,
} from '../infrastructure/run-journal-tool-executor';
import {
  SubAgentToolExecutor,
  subAgentToolDefinition,
} from '../infrastructure/sub-agent-tool-executor';

import type {
  RuntimeStudioAdvancedTools,
  RuntimeStudioAnalysisTools,
} from './runtime-studio.types';
import type { RuntimeToolRegistration } from './runtime-tool-router';

/**
 * The read-and-plan tools: the evidence graph and editor diagnostics, the plan
 * renderer, and the run journal. Grouped here for the same reason as the
 * advanced set — the studio is a composition root, not a catalogue, and it sits
 * on a 500-line ceiling that every new tool would otherwise push through.
 */
export function analysisToolRegistrations(
  parts: RuntimeStudioAnalysisTools,
): RuntimeToolRegistration[] {
  return [
    { definition: askUserToolDefinition, executor: new AskUserToolExecutor(parts.questions) },
    {
      definition: intelligenceToolDefinition,
      executor: new IntelligenceToolExecutor(parts.intelligence),
    },
    {
      definition: planningToolDefinition,
      executor: new PlanningToolExecutor(parts.transactions),
    },
    {
      definition: runJournalToolDefinition,
      executor: new RunJournalToolExecutor(parts.journals),
    },
  ];
}

/**
 * The evidence, service, sub-agent, integration, flagship and elevation tools.
 * They are grouped here so the studio stays a composition root rather than a
 * catalogue.
 */
export function advancedToolRegistrations(
  parts: RuntimeStudioAdvancedTools,
): RuntimeToolRegistration[] {
  return [
    {
      definition: evidenceToolDefinition,
      executor: new EvidenceToolExecutor(parts.evidence, parts.files),
    },
    {
      definition: developmentServiceToolDefinition,
      executor: new DevelopmentServiceToolExecutor(
        new DevelopmentServiceDiscovery(parts.files),
        parts.developmentServices,
      ),
    },
    { definition: subAgentToolDefinition, executor: new SubAgentToolExecutor(parts.subAgents) },
    {
      definition: integrationToolDefinition,
      executor: new IntegrationToolExecutor(parts.integration),
    },
    { definition: flagshipToolDefinition, executor: new FlagshipToolExecutor(parts.flagship) },
    {
      definition: elevationToolDefinition,
      executor: new ElevationToolExecutor(parts.elevation, parts.files, parts.activeRunId),
    },
  ];
}
