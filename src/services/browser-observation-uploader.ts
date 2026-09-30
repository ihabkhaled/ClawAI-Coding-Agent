import { basename, isAbsolute, relative, resolve } from 'node:path';

import { hashBrowserArtifact, type BrowserEvidence } from '../core/browser-operation';

import {
  BROWSER_OBSERVATION_CLIENT_ID_PREFIX,
  BROWSER_OBSERVATION_FILENAME_PREFIX,
  BROWSER_OBSERVATION_MIME_TYPE,
  MAX_BROWSER_OBSERVATION_UPLOAD_BYTES,
} from './browser-observation-upload.constants';

import type {
  BrowserObservationUploaderOptions,
  BrowserObservationUploadPort,
} from './browser-observation-upload.types';

/**
 * Uploads the screenshot a browser `observe` saved, so the next Runtime V2
 * turn is shown the image rather than only its path (F030).
 *
 * Every refusal is quiet and returns undefined: the observation itself
 * succeeded and its structured evidence still reaches the model, so a missing
 * image must never turn a working tool call into a failed one.
 */
export class BrowserObservationUploader implements BrowserObservationUploadPort {
  constructor(private readonly options: BrowserObservationUploaderOptions) {}

  async upload(evidence: BrowserEvidence, signal?: AbortSignal): Promise<string | undefined> {
    // Zero retention first: with it on, nothing leaves the machine to be stored.
    if (this.options.zeroRetention() || !this.options.acceptsImages()) return undefined;
    if (evidence.operation !== 'observe') return undefined;
    const { artifactPath, artifactHash } = evidence;
    if (artifactPath === undefined || artifactHash === undefined) return undefined;
    const absolute = this.insideRoot(artifactPath);
    if (absolute === undefined) return undefined;
    try {
      const bytes = await this.verifiedBytes(absolute, artifactHash);
      if (bytes === undefined) return undefined;
      const [fileId] = await this.options.uploads.upload(
        [
          {
            clientId: `${BROWSER_OBSERVATION_CLIENT_ID_PREFIX}${evidence.evidenceId}`,
            content: Buffer.from(bytes).toString('base64'),
            filename: `${BROWSER_OBSERVATION_FILENAME_PREFIX}${basename(artifactPath)}`,
            mimeType: BROWSER_OBSERVATION_MIME_TYPE,
            sizeBytes: bytes.byteLength,
          },
        ],
        signal ?? new AbortController().signal,
        () => undefined,
      );
      return fileId;
    } catch (error: unknown) {
      signal?.throwIfAborted();
      this.options.warn(
        `Browser observation not sent to the model: ${error instanceof Error ? error.message : 'upload failed'}.`,
      );
      return undefined;
    }
  }

  /** The screenshot bytes, when inside the upload bound and still the attested file. */
  private async verifiedBytes(
    absolute: string,
    artifactHash: string,
  ): Promise<Uint8Array | undefined> {
    const bytes = await this.options.readFile(absolute);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BROWSER_OBSERVATION_UPLOAD_BYTES) {
      this.options.warn(
        `Browser observation not sent to the model: ${String(bytes.byteLength)} bytes is outside the upload bound.`,
      );
      return undefined;
    }
    // The file on disk must still be the one the evidence attests to.
    if (hashBrowserArtifact(bytes) !== artifactHash) {
      this.options.warn('Browser observation not sent to the model: its hash changed on disk.');
      return undefined;
    }
    return bytes;
  }

  private insideRoot(artifactPath: string): string | undefined {
    const absolute = resolve(this.options.artifactRoot, artifactPath);
    const boundary = relative(this.options.artifactRoot, absolute);
    return boundary.startsWith('..') || isAbsolute(boundary) ? undefined : absolute;
  }
}
