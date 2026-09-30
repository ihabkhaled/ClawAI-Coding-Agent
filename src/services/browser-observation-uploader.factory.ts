import { readFile } from 'node:fs/promises';

import { selectedModelAcceptsImages } from '../core/model-vision';
import { zeroRetentionPosture } from '../core/zero-retention-posture';

import { AttachmentUploadService } from './attachment-upload-service';
import { BrowserObservationUploader } from './browser-observation-uploader';

import type { BackendClient } from '../backend/backend-client';
import type { ExtensionState } from '../core/extension-state';
import type { OutputLogger } from '../infrastructure/output-logger';

/** The uploader the host wires into `workspace.browser` (F030). */
export function browserObservationUploader(
  artifactRoot: string,
  state: ExtensionState,
  backend: () => BackendClient,
  logger: OutputLogger,
): BrowserObservationUploader {
  return new BrowserObservationUploader({
    artifactRoot,
    acceptsImages: () => selectedModelAcceptsImages(state.snapshot),
    zeroRetention: () => zeroRetentionPosture.active(),
    uploads: new AttachmentUploadService(backend),
    readFile: async (absolutePath) => readFile(absolutePath),
    warn: (message) => {
      logger.warn(message);
    },
  });
}
