import { Buffer } from 'node:buffer';

import { estimateImageTokens, imageDimensions, stripImageMetadata } from './image-metadata';

import type { AttachmentPreparation, PreparedAttachment } from './attachment-preparation.types';
import type { ChatAttachment } from './chat-attachment';

/** How many tokens of images one request may carry before the rest are refused. */
export const MAX_IMAGE_TOKENS_PER_REQUEST = 8_000;

/** Anything wider or taller than this is refused rather than silently truncated. */
export const MAX_IMAGE_EDGE_PIXELS = 8_000;

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/**
 * The one place an attachment is made ready to send.
 *
 * Both the image rules and the document rules live here on purpose. They share
 * every decision that matters — what a model can actually accept, what a
 * request can afford, and what must be removed before anything leaves the
 * machine — and splitting them would mean the second one written quietly
 * disagreed with the first.
 *
 * Refusals are returned, never thrown. One unusable attachment should cost the
 * user that attachment and a reason, not the message they were writing.
 */
export function prepareAttachments(
  attachments: readonly ChatAttachment[],
  input: { readonly modelAcceptsImages: boolean },
): AttachmentPreparation {
  const prepared: PreparedAttachment[] = [];
  const refused: AttachmentPreparation['refused'] = [];
  let imageTokens = 0;
  for (const attachment of attachments) {
    if (!isImage(attachment.mimeType)) {
      prepared.push({ attachment });
      continue;
    }
    if (!input.modelAcceptsImages) {
      refused.push({ filename: attachment.filename, reason: 'model-cannot-see' });
      continue;
    }
    const bytes = new Uint8Array(Buffer.from(attachment.content, 'base64'));
    const size = imageDimensions(bytes, attachment.mimeType);
    if (size !== undefined && Math.max(size.width, size.height) > MAX_IMAGE_EDGE_PIXELS) {
      refused.push({ filename: attachment.filename, reason: 'too-large' });
      continue;
    }
    // An unreadable header costs nothing against the budget rather than an
    // invented number: guessing high refuses working attachments, and guessing
    // low is the same as not budgeting.
    const tokens = size === undefined ? 0 : estimateImageTokens(size);
    if (imageTokens + tokens > MAX_IMAGE_TOKENS_PER_REQUEST) {
      refused.push({ filename: attachment.filename, reason: 'budget-exhausted' });
      continue;
    }
    imageTokens += tokens;
    const stripped = stripImageMetadata(bytes, attachment.mimeType);
    prepared.push({
      attachment:
        stripped === bytes
          ? attachment
          : {
              ...attachment,
              content: Buffer.from(stripped).toString('base64'),
              sizeBytes: stripped.length,
            },
      ...(size === undefined ? {} : { estimatedTokens: tokens }),
    });
  }
  return { prepared, refused, estimatedImageTokens: imageTokens };
}
