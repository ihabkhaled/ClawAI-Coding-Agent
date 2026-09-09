import { z } from 'zod';

import { uploadedFileSchema, type UploadedFile } from './contracts';

import type { ChatAttachment } from '../core/chat-attachment';

type FileRequester = <T>(
  path: string,
  schema: z.ZodType<T>,
  options: { method: 'POST' | 'DELETE'; body?: unknown; signal?: AbortSignal },
) => Promise<T>;

/**
 * Uploads one attachment.
 *
 * Only the four fields the contract names are sent. A `ChatAttachment` carries
 * local bookkeeping as well, and forwarding the whole object would ship
 * whatever is added to it next without anyone deciding to.
 */
export async function uploadFile(
  request: FileRequester,
  input: ChatAttachment,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  return request('/files/upload', uploadedFileSchema, {
    body: {
      content: input.content,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function deleteFile(request: FileRequester, id: string): Promise<void> {
  await request(`/files/${encodeURIComponent(id)}`, z.unknown(), { method: 'DELETE' });
}
