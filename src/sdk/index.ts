/**
 * The public surface of the agent SDK.
 *
 * One module, so what is supported is a list a reader can hold in their head
 * rather than whatever happens to be exported from somewhere inside. Anything
 * not here is an implementation detail and may move.
 *
 * Nothing reachable from here imports `vscode`; a test builds this graph and
 * fails if one ever does.
 */
export { createAgent } from './create-agent';
export { orchestrate } from './orchestrate';
export { validatePlan } from './orchestrate-validate';
export { describePlan } from './orchestrate-format';
export { runAgent } from './agent-sdk';
export { toolResultFor } from './agent-tool-result';
export { workspaceToolkit, offeredDefinitions, toolCategory } from './workspace-toolkit';
export { AGENT_SDK_DEFAULTS } from './agent-sdk.constants';
export { AGENT_BUDGET_PROFILES, AGENT_BUDGET_PROFILE_NAMES } from './budget-profiles.constants';
export { AUTO_CONTINUE_MAX } from './server-budget.constants';
export { AGENT_MAX_SYSTEM_PROMPT_CHARS } from './agent-inputs.constants';
export { AGENT_PERMISSION_MODES } from './permission-modes.constants';
export { AGENT_RESEARCH_FLAG_VALUES, WEB_RESEARCH_MODE_OPERATIONS } from './web-toolkit.constants';
export { promptWithContext } from './agent-context';
export { webToolkit } from './web-toolkit';
export { httpWebResearch } from './web-research-http';
export { visionToolkit } from './vision-tool';
export { httpVision } from './vision-port-http';
export { loadPromptImages } from './prompt-images';
export { permissionsForMode } from './permission-modes';
export { mcpToolkit } from './mcp-toolkit';
export { browserToolkit } from './browser-toolkit';
export type { AgentBrowserOptions } from './browser-tool.types';
export { combineToolkits, restrictToolkit } from './toolkit-compose';
export { toolIdentifiers, toolPermitted } from './tool-filter';
export {
  AGENT_DEFAULT_TOOL_CATEGORIES,
  AGENT_WORKSPACE_TOOL_DEFINITIONS,
} from './workspace-toolkit.constants';
export { HeadlessTransport, canonicalJson, sha256 } from '../headless/headless-transport';
export { RuntimeHttpError } from '../headless/runtime-http-error';
export {
  describeHeadlessOutcome,
  headlessExitCode,
  outcomeFromError,
  outcomeFromTerminalEvent,
} from '../core/headless-outcome';
export { HEADLESS_EXIT_CODES } from '../core/headless-outcome.constants';
export { containedPath } from '../core/workspace-containment';
export { inheritedEnvironment } from '../core/inherited-environment';

export type { AgentVisionOptions, VisionPort } from './vision-tool.types';
export type {
  AgentBudgetField,
  AgentBudgetProfile,
  AgentRunOptions,
  AgentRunResult,
  AgentToolCall,
  AgentToolkit,
  RuntimeTransportPort,
} from './agent-sdk.types';
export type {
  Agent,
  AgentAuth,
  AgentConfig,
  AgentEvent,
  AgentResult,
  AgentRunCallOptions,
} from './create-agent.types';
export type {
  DoneCheck,
  DoneCheckOutcome,
  DoneCheckSummary,
  DoneChecksReport,
} from './done-checks.types';
export type { RunBudgetKind, RunBudgetTrip } from './run-budget.types';
export type { PlanStepCheck, PlanStepInput, PlanSummary } from './task-plan-tool.types';
export type { AgentMcpOptions } from './mcp-toolkit.types';
export type {
  AgentContextConfig,
  AgentContextFileSystem,
  AgentContextResult,
} from './agent-context.types';
export type { EffortMode } from '../core/effort-mode';
export type { SpeedMode } from '../core/speed-mode';
export type { ResearchMode } from '../core/research-mode';
export type { ContextMode } from '../core/context-mode';
export type { WebResearchPort } from '../core/web-research.types';
export type { AgentPermissionMode } from './permission-modes.types';
export type { AgentToolFilter } from './tool-filter.types';
export type {
  AgentApprovalRequest,
  AgentPermissions,
  AgentToolCategory,
} from './workspace-toolkit.types';
export type { HeadlessExitCode, HeadlessOutcome } from '../core/headless-outcome.types';
export type { HeadlessStreamEvent } from '../headless/headless-session.types';
export type { HeadlessRunRequest } from '../headless/headless-transport.types';
export type {
  McpHttpServerConfig,
  McpOAuthConfig,
  McpServerConfig,
  McpServerOrigin,
  McpStdioServerConfig,
} from '../core/mcp/mcp.types';
export type { McpTokenProvider } from '../infrastructure/mcp/mcp-transport.types';
export type { RetryTuning } from '../headless/retry-policy.types';
export type { ShellOptions } from './shell-tool.types';
export type { StuckInfo } from './repetition-guard.types';
export type { AgentMemoryMode, AgentModelChoice } from './agent-sdk.types';
export type {
  VisionAskInput,
  VisionCatalogModel,
  VisionImage,
  VisionMimeType,
} from './vision-tool.types';
export type { WebFetchInput, WebSearchInput } from '../core/web-research.types';
export type {
  OrchestrateEvent,
  OrchestrateOptions,
  OrchestratePlan,
  OrchestrateReport,
} from './orchestrate.types';
export type { OrchestrateOutcome } from './orchestrate';
export type { BrowserResolver } from './browser-egress.types';
