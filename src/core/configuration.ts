import { z } from 'zod';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'claw.local']);

const routingModeSchema = z.enum(['AUTO', 'MANUAL_MODEL']);
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

export function normalizeBackendUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ClawAI backend URL must use HTTP or HTTPS.');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error('ClawAI backend URL must not contain credentials.');
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    throw new Error('ClawAI backend URL must not contain a query or fragment.');
  }
  if (url.protocol === 'http:' && !loopbackHosts.has(url.hostname)) {
    throw new Error('Non-local ClawAI backends must use HTTPS.');
  }

  const path = url.pathname.replace(/\/+$/u, '').replace(/\/api\/v1$/u, '');
  return `${url.origin}${path === '/' ? '' : path}`;
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
