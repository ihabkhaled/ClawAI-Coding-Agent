import { z } from 'zod';

import { BackendRequestError } from './backend-errors';

import type { ResearchRequester } from './research-client';

/** What a publish returns. `.loose()` so a field the backend adds later is not a failure. */
export const publishedArtifactSchema = z
  .object({ id: z.string().min(1), url: z.string().min(1) })
  .loose();

export interface ArtifactUpload {
  readonly filename: string;
  readonly mimeType: string;
  readonly content: string;
  readonly sha256: string;
  readonly title?: string | undefined;
}

export type ArtifactPublishOutcome =
  | { readonly status: 'published'; readonly id: string; readonly url: string }
  /** The backend has no route for this. Reported as such, never as a success. */
  | { readonly status: 'route-missing'; readonly detail: string };

/** The one call the artifact tool makes. */
export interface ArtifactPublisherPort {
  publish(upload: ArtifactUpload, signal?: AbortSignal): Promise<ArtifactPublishOutcome>;
}

const ROUTE_MISSING = new Set([404, 405, 501]);

/**
 * Publishes one scrubbed file as a hosted page.
 *
 * The monorepo has no artifact route yet (only chat-thread shares exist), so a
 * 404 is an expected answer today and is surfaced as `route-missing` instead of
 * a generic failure. Every other error propagates unchanged.
 */
export async function publishArtifact(
  request: ResearchRequester,
  upload: ArtifactUpload,
  signal?: AbortSignal,
): Promise<ArtifactPublishOutcome> {
  try {
    const published = await request('/artifacts', publishedArtifactSchema, {
      method: 'POST',
      body: upload,
      ...(signal === undefined ? {} : { signal }),
    });
    return { status: 'published', id: published.id, url: published.url };
  } catch (error) {
    if (error instanceof BackendRequestError && ROUTE_MISSING.has(error.status)) {
      return {
        status: 'route-missing',
        detail: `The ClawAI backend has no artifact-publishing route (HTTP ${String(error.status)}). The scrubbed bundle was prepared but nothing was uploaded.`,
      };
    }
    throw error;
  }
}
