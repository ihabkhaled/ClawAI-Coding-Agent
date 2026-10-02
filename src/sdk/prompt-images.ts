import path from 'node:path';

import { readOperatorImage } from './vision-image-files';
import { VISION_MAX_PROMPT_IMAGES } from './vision-tool.constants';

import type { RuntimeTransportPort } from './agent-sdk.types';
import type { VisionImage } from './vision-tool.types';

/**
 * The images the operator attached to the first prompt, read and checked.
 *
 * Done when the agent is built, before any request, so a missing file, a wrong
 * type or a name that looks like a secret is a usage error, not a half-started
 * run. Relative paths are taken from `base`.
 */
export function loadPromptImages(paths: readonly string[], base: string): readonly VisionImage[] {
  if (paths.length > VISION_MAX_PROMPT_IMAGES) {
    throw new RangeError(
      `At most ${String(VISION_MAX_PROMPT_IMAGES)} images can be attached to a prompt; ${String(paths.length)} were given.`,
    );
  }
  try {
    return paths.map((entry) => readOperatorImage(path.resolve(base, entry)));
  } catch (error) {
    // A usage mistake found before any request, which the headless runner reports as exit 2.
    throw new RangeError(error instanceof Error ? error.message : 'An image could not be read.');
  }
}

/**
 * Checks that the backend kept the attachments on the run's prompt, and says so
 * when it did not. Nothing here can fail the run: a transport that cannot tell,
 * or a lookup that errors, leaves the run as it was.
 */
export async function reportUndeliveredImages(
  transport: RuntimeTransportPort,
  token: string,
  run: { threadId: string; runId: string },
  sent: readonly string[] | undefined,
  report: ((info: { sent: number; delivered: number }) => void) | undefined,
): Promise<void> {
  if (sent === undefined || transport.attachedFileIds === undefined) return;
  try {
    const kept = await transport.attachedFileIds(token, run);
    const delivered =
      kept === undefined ? undefined : sent.filter((id) => kept.includes(id)).length;
    if (delivered !== undefined && delivered < sent.length) {
      report?.({ sent: sent.length, delivered });
    }
  } catch {
    // The check is advisory.
  }
}

/**
 * Uploads the images and returns the `fileIds` field for the run request, or nothing.
 *
 * A transport that cannot upload is a stated limit, not a silent drop: the run
 * would otherwise go ahead and answer as if no image had been attached.
 */
export async function uploadPromptImages(
  transport: RuntimeTransportPort,
  token: string,
  images: readonly VisionImage[] | undefined,
): Promise<{ fileIds?: readonly string[] }> {
  if (images === undefined || images.length === 0) return {};
  if (transport.uploadImage === undefined) {
    throw new Error('This backend connection cannot attach images: the transport has no upload.');
  }
  const ids: string[] = [];
  for (const image of images) ids.push(await transport.uploadImage(token, image));
  return { fileIds: ids };
}
