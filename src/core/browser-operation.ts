import { createHash } from 'node:crypto';

import { z } from 'zod';

import { isSafeRelativeWorkspacePath } from './workspace-path-policy';

const locatorSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('role'),
      role: z.string().min(1).max(80),
      name: z.string().max(500).optional(),
      exact: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal('label'),
      value: z.string().min(1).max(500),
      exact: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal('test-id'), value: z.string().min(1).max(500) }).strict(),
  z
    .object({
      kind: z.literal('text'),
      value: z.string().min(1).max(500),
      exact: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal('css'), value: z.string().min(1).max(2_000) }).strict(),
]);

export const browserOperationSchema = z
  .object({
    sessionId: z.string().min(8).max(200),
    operation: z.enum([
      'launch',
      'close',
      'new-context',
      'close-context',
      'new-tab',
      'close-tab',
      'navigate',
      'snapshot',
      'locate',
      'click',
      'fill',
      'select',
      'keyboard',
      'hover',
      'drag',
      'upload',
      'download',
      'screenshot',
      'pdf',
      'console',
      'network',
      'storage',
      'trace-start',
      'trace-stop',
      'video',
      'accessibility',
      'measure-layout',
      'takeover',
      'return-control',
    ]),
    contextId: z.string().min(1).max(200).optional(),
    pageId: z.string().min(1).max(200).optional(),
    url: z.url().max(4_096).optional(),
    locator: locatorSchema.optional(),
    targetLocator: locatorSchema.optional(),
    value: z.string().max(1_048_576).optional(),
    values: z.array(z.string().max(32_768)).max(100).optional(),
    relativePaths: z.array(z.string().refine(isSafeRelativeWorkspacePath)).max(100).optional(),
    artifactPath: z.string().refine(isSafeRelativeWorkspacePath).optional(),
    viewport: z
      .object({
        width: z.number().int().min(240).max(10_000),
        height: z.number().int().min(240).max(10_000),
      })
      .strict()
      .optional(),
    timeoutMs: z.number().int().min(100).max(600_000).default(30_000),
    fullPage: z.boolean().default(false),
  })
  .strict();

export type BrowserOperation = z.infer<typeof browserOperationSchema>;
export type BrowserLocator = z.infer<typeof locatorSchema>;

export const browserScopeSchema = z
  .object({
    allowedOrigins: z.array(z.url().max(2_048)).max(100),
    allowExternalNavigationWithApproval: z.boolean(),
    allowDownloads: z.boolean(),
    maxDownloadBytes: z.number().int().min(1).max(1_073_741_824),
  })
  .strict();

export type BrowserScope = z.infer<typeof browserScopeSchema>;

export function browserOrigin(url: string): string {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('Browser URL scheme is forbidden');
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('Browser URL credentials are forbidden');
  }
  return parsed.origin;
}

export function isOriginAllowed(url: string, scope: BrowserScope): boolean {
  const origin = browserOrigin(url);
  return scope.allowedOrigins.some((allowed) => browserOrigin(allowed) === origin);
}

export interface BrowserEvidence {
  readonly evidenceId: string;
  readonly timestamp: string;
  readonly operation: BrowserOperation['operation'];
  readonly origin?: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly artifactPath?: string;
  readonly artifactHash?: string;
  readonly consoleFailures: readonly string[];
  readonly networkFailures: readonly string[];
  readonly accessibilityViolations: number;
  readonly redactionApplied: boolean;
}

export function hashBrowserArtifact(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export class BrowserTakeoverState {
  private owner: 'agent' | 'user' = 'agent';

  currentOwner(): 'agent' | 'user' {
    return this.owner;
  }

  takeOver(): void {
    if (this.owner === 'user') throw new Error('Browser control is already assigned to the user');
    this.owner = 'user';
  }

  returnControl(): void {
    if (this.owner !== 'user') throw new Error('Browser control is not assigned to the user');
    this.owner = 'agent';
  }

  assertAgentControl(): void {
    if (this.owner !== 'agent') throw new Error('Browser input is paused during user takeover');
  }
}
