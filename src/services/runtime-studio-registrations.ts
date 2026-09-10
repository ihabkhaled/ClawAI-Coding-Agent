import {
  AdvisorToolExecutor,
  advisorToolDefinition,
} from '../infrastructure/advisor-tool-executor';
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
  EndConversationToolExecutor,
  endConversationToolDefinition,
} from '../infrastructure/end-conversation-tool-executor';
import {
  EvidenceToolExecutor,
  evidenceToolDefinition,
} from '../infrastructure/evidence-tool-executor';
import {
  FlagshipToolExecutor,
  flagshipToolDefinition,
} from '../infrastructure/flagship-tool-executor';
import { GoalToolExecutor, goalToolDefinition } from '../infrastructure/goal-tool-executor';
import {
  IntegrationToolExecutor,
  integrationToolDefinition,
} from '../infrastructure/integration-tool-executor';
import {
  IntelligenceToolExecutor,
  intelligenceToolDefinition,
} from '../infrastructure/intelligence-tool-executor';
import {
  MonitorToolExecutor,
  monitorToolDefinition,
} from '../infrastructure/monitor-tool-executor';
import {
  NotebookToolExecutor,
  notebookToolDefinition,
} from '../infrastructure/notebook-tool-executor';
import {
  NotifyUserToolExecutor,
  notifyUserToolDefinition,
} from '../infrastructure/notify-user-tool-executor';
import {
  PlanningToolExecutor,
  planningToolDefinition,
} from '../infrastructure/planning-tool-executor';
import {
  ProcessSupervisorToolExecutor,
  processSupervisorToolDefinition,
} from '../infrastructure/process-supervisor-tool-executor';
import {
  RunJournalToolExecutor,
  runJournalToolDefinition,
} from '../infrastructure/run-journal-tool-executor';
import {
  StructuredCommandToolExecutor,
  structuredCommandToolDefinition,
} from '../infrastructure/structured-command-tool-executor';
import {
  SubAgentToolExecutor,
  subAgentToolDefinition,
} from '../infrastructure/sub-agent-tool-executor';
import {
  VscodeFilesystemToolExecutor,
  workspaceFilesystemToolDefinition,
} from '../infrastructure/vscode-filesystem-tool-executor';
import { VscodeMonitorPort } from '../infrastructure/vscode-monitor-port';
import { VscodeNotebookReader } from '../infrastructure/vscode-notebook-reader';
import { VscodeUserNotifier } from '../infrastructure/vscode-user-notifier';
import {
  WebResearchToolExecutor,
  webResearchToolDefinition,
} from '../infrastructure/web-research-tool-executor';

import type {
  RuntimeStudioAdvancedTools,
  RuntimeStudioAnalysisTools,
  RuntimeStudioWorkspaceTools,
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
    { definition: advisorToolDefinition, executor: new AdvisorToolExecutor(parts.advisor) },
    { definition: goalToolDefinition, executor: new GoalToolExecutor(parts.goal) },
    {
      definition: monitorToolDefinition,
      executor: new MonitorToolExecutor(new VscodeMonitorPort(parts.files)),
    },
    { definition: askUserToolDefinition, executor: new AskUserToolExecutor(parts.questions) },
    {
      definition: endConversationToolDefinition,
      executor: new EndConversationToolExecutor(parts.conversationEnd),
    },
    {
      definition: intelligenceToolDefinition,
      executor: new IntelligenceToolExecutor(parts.intelligence),
    },
    {
      definition: notifyUserToolDefinition,
      executor: new NotifyUserToolExecutor(new VscodeUserNotifier()),
    },
    {
      definition: planningToolDefinition,
      executor: new PlanningToolExecutor(parts.transactions, parts.tasks),
    },
    {
      definition: runJournalToolDefinition,
      executor: new RunJournalToolExecutor(parts.journals),
    },
    {
      definition: notebookToolDefinition,
      executor: new NotebookToolExecutor(
        parts.transactions,
        new VscodeNotebookReader((key) => parts.files.workspaceRootUri(key)),
      ),
    },
    {
      definition: webResearchToolDefinition,
      executor: new WebResearchToolExecutor(parts.research),
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

/**
 * The three tools every run reaches for first: the filesystem, a bounded
 * command, and the process supervisor. Grouped out of the studio for the same
 * reason as the other two sets — it is a composition root on a 500-line
 * ceiling, and these three carry the most constructor arguments of any of them.
 */
export function workspaceToolRegistrations(
  parts: RuntimeStudioWorkspaceTools,
): RuntimeToolRegistration[] {
  return [
    {
      definition: workspaceFilesystemToolDefinition,
      executor: new VscodeFilesystemToolExecutor(parts.files, parts.transactions, parts.artifacts),
    },
    {
      definition: structuredCommandToolDefinition,
      executor: new StructuredCommandToolExecutor(parts.files),
    },
    {
      definition: processSupervisorToolDefinition,
      executor: new ProcessSupervisorToolExecutor(parts.processes, parts.accountId, parts.files),
    },
  ];
}
