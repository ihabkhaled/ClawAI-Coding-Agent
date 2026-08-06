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
  SubAgentToolExecutor,
  subAgentToolDefinition,
} from '../infrastructure/sub-agent-tool-executor';

import type { RuntimeStudioAdvancedTools } from './runtime-studio.types';
import type { RuntimeToolRegistration } from './runtime-tool-router';

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
