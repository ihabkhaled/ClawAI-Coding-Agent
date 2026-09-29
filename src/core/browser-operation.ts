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

const MAX_SCROLL_DELTA = 5_000;
const pointSchema = z
  .object({ x: z.number().int().min(0).max(10_000), y: z.number().int().min(0).max(10_000) })
  .strict();

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
      'click-at',
      'type-text',
      'scroll',
      'observe',
    ]),
    contextId: z.string().min(1).max(200).optional(),
    pageId: z.string().min(1).max(200).optional(),
    url: z.url().max(4_096).optional(),
    locator: locatorSchema.optional(),
    targetLocator: locatorSchema.optional(),
    value: z.string().max(1_048_576).optional(),
    point: pointSchema.optional(),
    delta: z
      .object({
        x: z.number().int().min(-MAX_SCROLL_DELTA).max(MAX_SCROLL_DELTA),
        y: z.number().int().min(-MAX_SCROLL_DELTA).max(MAX_SCROLL_DELTA),
      })
      .strict()
      .optional(),
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

/** Longest text `type-text` will send to the page in one call. */
export const MAX_TYPED_TEXT_CHARACTERS = 4_096;
/** Most element boxes `observe` returns, so a busy page cannot flood the model. */
export const MAX_OBSERVED_ELEMENTS = 60;

export interface BrowserViewport {
  readonly width: number;
  readonly height: number;
}

/**
 * A coordinate the model chose must land inside the page it is looking at.
 * Coordinates are refused, never clamped: a click at a clamped position is a
 * click the model did not ask for, on a control it may not have seen.
 */
export function assertPointInViewport(
  point: { readonly x: number; readonly y: number } | undefined,
  viewport: BrowserViewport | undefined,
): { readonly x: number; readonly y: number } {
  if (point === undefined) throw new Error('Browser operation requires a point');
  if (viewport === undefined) throw new Error('Browser viewport is unavailable');
  if (point.x >= viewport.width || point.y >= viewport.height) {
    throw new Error('Browser point is outside the viewport');
  }
  return point;
}

export interface ObservedElement {
  readonly role: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Keeps only boxes that are visible inside the viewport, bounded in number and
 * with each name truncated. The centre of a box is a point `click-at` accepts.
 */
export function boundObservedElements(
  elements: readonly ObservedElement[],
  viewport: BrowserViewport,
  redact: (text: string) => string,
): ObservedElement[] {
  return elements
    .filter(
      (element) =>
        element.width > 0 &&
        element.height > 0 &&
        element.x >= 0 &&
        element.y >= 0 &&
        element.x < viewport.width &&
        element.y < viewport.height,
    )
    .slice(0, MAX_OBSERVED_ELEMENTS)
    .map((element) => ({
      ...element,
      name: redact(element.name.slice(0, 120)),
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
    }));
}
