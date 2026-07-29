import { chatAttachmentsSchema } from '../core/chat-attachment';

import type { ChatAttachment } from '../core/chat-attachment';

interface AttachmentUploadBackendPort {
  deleteFile(id: string): Promise<void>;
  uploadFile(input: ChatAttachment, signal?: AbortSignal): Promise<{ id: string }>;
}

export interface AttachmentUploadProgress {
  attachment: ChatAttachment;
  index: number;
  status: 'uploaded' | 'uploading';
  total: number;
}

export class AttachmentUploadService {
  constructor(private readonly backend: () => AttachmentUploadBackendPort) {}

  async upload(
    attachments: ChatAttachment[],
    signal: AbortSignal,
    onProgress: (progress: AttachmentUploadProgress) => void,
  ): Promise<string[]> {
    const validated = chatAttachmentsSchema.parse(attachments);
    const backend = this.backend();
    const fileIds: string[] = [];
    try {
      for (const [index, attachment] of validated.entries()) {
        signal.throwIfAborted();
        onProgress({
          attachment,
          index,
          status: 'uploading',
          total: validated.length,
        });
        const uploaded = await backend.uploadFile(attachment, signal);
        fileIds.push(uploaded.id);
        signal.throwIfAborted();
        onProgress({
          attachment,
          index,
          status: 'uploaded',
          total: validated.length,
        });
      }
    } catch (error: unknown) {
      await Promise.allSettled(fileIds.map((id) => backend.deleteFile(id)));
      throw error;
    }
    return fileIds;
  }
}
