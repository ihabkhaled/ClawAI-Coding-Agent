import { z } from 'zod';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'claw.local']);

export const BACKEND_LOCAL_URL = 'https://claw.local';
export const FRONTEND_LOCAL_URL = 'https://claw.local';
export const BACKEND_CLOUD_URL = 'https://claw-ai.co';
export const FRONTEND_CLOUD_URL = 'https://claw-ai.co';

export const connectionEnvironmentSchema = z.enum(['LOCAL', 'CLOUD', 'CUSTOM']);
export type ConnectionEnvironment = z.infer<typeof connectionEnvironmentSchema>;

export interface ConnectionProfile {
  backendEnvironment: ConnectionEnvironment;
  backendCustomUrl: string;
  frontendEnvironment: ConnectionEnvironment;
  frontendCustomUrl: string;
}

/**
 * The routing strategies the backend actually offers.
 *
 * The extension exposed two of these seven for as long as it has existed, and
 * the other five were never missing from the backend — they were unreachable
 * from here. A user who wanted local-only or cost-conscious routing had to
 * pick a model by hand and keep picking, which is the manual mode wearing a
 * different hat.
 *
 * Only `MANUAL_MODEL` names a model. Every other value hands the choice to the
 * router, which is why the code asks whether a mode is router-selected rather
 * than whether it equals `AUTO`: a check written against one router mode is a
 * check that silently excludes the other five.
 */
export const ROUTING_MODES = [
  'AUTO',
  'MANUAL_MODEL',
  'LOCAL_ONLY',
  'PRIVACY_FIRST',
  'LOW_LATENCY',
  'HIGH_REASONING',
  'COST_SAVER',
] as const;

const routingModeSchema = z.enum(ROUTING_MODES);
const storedRoutingModeSchema = z.preprocess(
  (value) => (value === 'MANUAL' ? 'MANUAL_MODEL' : value),
  routingModeSchema,
);
const workspaceContextSchema = z
  .object({
    maxBytes: z.number().int().min(1_000).max(2_000_000).optional(),
    maxFiles: z.number().int().min(1).max(200).optional(),
    exclude: z.array(z.string().min(1).max(500)).max(100).optional(),
  })
  .strict();
const workspaceConfigurationSchema = z
  .object({
    routingMode: storedRoutingModeSchema.optional(),
    selectedModel: z.string().max(500).optional(),
    systemPrompt: z.string().max(10_000).optional(),
    context: workspaceContextSchema.optional(),
  })
  .strict();

export type RoutingMode = z.infer<typeof routingModeSchema>;
export type WorkspaceConfiguration = z.infer<typeof workspaceConfigurationSchema>;

export interface GlobalConfiguration {
  routingMode: RoutingMode;
  selectedModel: string;
  maxContextBytes: number;
  maxContextFiles: number;
  exclude: string[];
  systemPrompt?: string;
}

export function normalizeRoutingMode(value: unknown): RoutingMode {
  return storedRoutingModeSchema.parse(value);
}

/**
 * Whether the router picks the model for this mode.
 *
 * Six of the seven modes answer yes. Writing `mode === 'AUTO'` at a call site
 * is the bug this exists to prevent: it was correct while there were two modes
 * and silently wrong the moment there were seven, in a direction nothing would
 * report — a cost-saver run treated as manual looks for a model key that mode
 * never sets.
 */
export function isRouterSelectedMode(mode: RoutingMode): boolean {
  return mode !== 'MANUAL_MODEL';
}

/**
 * Whether a string the panel sent is a routing strategy rather than a model
 * key. Both arrive in the same field because the user is answering one
 * question: how should the next request be routed.
 */
export function isRoutingModeName(value: string): value is RoutingMode {
  return (ROUTING_MODES as readonly string[]).includes(value);
}

export function normalizeBackendUrl(value: string): string {
  return normalizeAppUrl(value, 'backend');
}

export function normalizeFrontendUrl(value: string): string {
  return normalizeAppUrl(value, 'frontend');
}

function normalizeAppUrl(value: string, kind: 'backend' | 'frontend'): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ClawAI ${kind} URL must use HTTP or HTTPS.`);
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error(`ClawAI ${kind} URL must not contain credentials.`);
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error(`ClawAI ${kind} URL must not contain a query or fragment.`);
  }
  if (url.protocol === 'http:' && !loopbackHosts.has(url.hostname)) {
    throw new Error(`Non-local ClawAI ${kind} URLs must use HTTPS.`);
  }

  const path = url.pathname.replace(/\/+$/u, '').replace(/\/api\/v1$/u, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

export function resolveConnectionEndpoint(
  kind: 'backend' | 'frontend',
  environment: ConnectionEnvironment,
  customUrl: string,
): string {
  if (environment === 'CLOUD') {
    return kind === 'backend' ? BACKEND_CLOUD_URL : FRONTEND_CLOUD_URL;
  }
  if (environment === 'LOCAL') {
    return kind === 'backend' ? BACKEND_LOCAL_URL : FRONTEND_LOCAL_URL;
  }
  if (customUrl.trim().length === 0) {
    throw new Error(`Enter a custom ClawAI ${kind} URL.`);
  }
  return kind === 'backend' ? normalizeBackendUrl(customUrl) : normalizeFrontendUrl(customUrl);
}

export function joinAppUrl(frontendUrl: string, path: string): string {
  const base = normalizeFrontendUrl(frontendUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

export function joinApiUrl(backendUrl: string, apiPath: string): string {
  const base = normalizeBackendUrl(backendUrl);
  const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}/api/v1${path}`;
}

export function parseWorkspaceConfiguration(value: unknown): WorkspaceConfiguration {
  return workspaceConfigurationSchema.parse(value);
}

export function mergeConfiguration(
  globalConfiguration: GlobalConfiguration,
  workspaceConfiguration: WorkspaceConfiguration,
): GlobalConfiguration {
  const workspaceContext = workspaceConfiguration.context;
  return {
    ...globalConfiguration,
    ...(workspaceConfiguration.routingMode === undefined
      ? {}
      : { routingMode: workspaceConfiguration.routingMode }),
    ...(workspaceConfiguration.selectedModel === undefined
      ? {}
      : { selectedModel: workspaceConfiguration.selectedModel }),
    ...(workspaceConfiguration.systemPrompt === undefined
      ? {}
      : { systemPrompt: workspaceConfiguration.systemPrompt }),
    maxContextBytes: workspaceContext?.maxBytes ?? globalConfiguration.maxContextBytes,
    maxContextFiles: workspaceContext?.maxFiles ?? globalConfiguration.maxContextFiles,
    exclude: [...new Set([...globalConfiguration.exclude, ...(workspaceContext?.exclude ?? [])])],
  };
}
