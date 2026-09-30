import type { BrowserEvidence } from '../core/browser-operation';
import type { ChatAttachment } from '../core/chat-attachment';

/** Hands an `observe` screenshot to the backend so the next model turn sees it (F030). */
export interface BrowserObservationUploadPort {
  /** The uploaded file id, or undefined when the screenshot is not sent. */
  upload(evidence: BrowserEvidence, signal?: AbortSignal): Promise<string | undefined>;
}

/** The existing attachment upload client (`AttachmentUploadService`). */
export interface BrowserObservationAttachmentUploader {
  upload(
    attachments: ChatAttachment[],
    signal: AbortSignal,
    onProgress: () => void,
  ): Promise<string[]>;
}

export interface BrowserObservationUploaderOptions {
  /** Absolute root the Playwright driver writes browser evidence under. */
  readonly artifactRoot: string;
  /** Whether the selected model can read an image (`selectedModelAcceptsImages`). */
  readonly acceptsImages: () => boolean;
  /** Whether zero data retention is on; nothing is uploaded while it is. */
  readonly zeroRetention: () => boolean;
  readonly uploads: BrowserObservationAttachmentUploader;
  readonly readFile: (absolutePath: string) => Promise<Uint8Array>;
  readonly warn: (message: string) => void;
}
