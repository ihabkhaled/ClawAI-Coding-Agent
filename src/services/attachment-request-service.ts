import { createHash } from 'node:crypto';

import * as vscode from 'vscode';

import { chatAttachmentsSchema } from '../core/chat-attachment';

import {
  AttachmentUploadService,
  type AttachmentUploadProgress,
} from './attachment-upload-service';

import type { BackendClient } from '../backend/backend-client';
import type { ChatAttachment } from '../core/chat-attachment';
import type { ChatViewProvider } from '../webview/chat-view-provider';

const MAX_CACHED_ATTACHMENTS = 100;

interface CachedAttachment {
  fingerprint: string;
  id: string;
}

export interface AttachmentLease {
  fileIds: string[];
  accept(): void;
  rollback(): Promise<void>;
}

function attachmentFingerprint(attachment: ChatAttachment): string {
  return createHash('sha256')
    .update(attachment.filename)
    .update('\0')
    .update(attachment.mimeType)
    .update('\0')
    .update(String(attachment.sizeBytes))
    .update('\0')
    .update(attachment.content)
    .digest('hex');
}

export class AttachmentRequestService {
  private readonly cache = new Map<string, CachedAttachment>();
  private readonly uploads: AttachmentUploadService;

  constructor(
    private readonly backend: () => BackendClient,
    private readonly view: () => ChatViewProvider | null,
  ) {
    this.uploads = new AttachmentUploadService(backend);
  }

  async acquire(
    attachments: ChatAttachment[],
    signal: AbortSignal,
    requestId: string,
  ): Promise<AttachmentLease> {
    const validated = chatAttachmentsSchema.parse(attachments);
    const resolved = new Map<string, string>();
    const missing: ChatAttachment[] = [];
    for (const attachment of validated) {
      const fingerprint = attachmentFingerprint(attachment);
      const cached = this.cache.get(attachment.clientId);
      if (cached?.fingerprint === fingerprint) {
        resolved.set(attachment.clientId, cached.id);
      } else {
        missing.push(attachment);
      }
    }
    const uploadedIds = await this.uploads.upload(missing, signal, (progress) => {
      void this.view()?.postEvent(this.progressEvent(progress), requestId);
    });
    const created: { clientId: string; fingerprint: string; id: string }[] = [];
    for (const [index, attachment] of missing.entries()) {
      const id = uploadedIds[index];
      if (id === undefined) {
        throw new Error(vscode.l10n.t('ClawAI attachment upload did not return a file ID.'));
      }
      const entry = {
        clientId: attachment.clientId,
        fingerprint: attachmentFingerprint(attachment),
        id,
      };
      created.push(entry);
      resolved.set(entry.clientId, entry.id);
      this.cache.delete(entry.clientId);
      this.cache.set(entry.clientId, { fingerprint: entry.fingerprint, id: entry.id });
    }
    this.pruneCache();
    let accepted = false;
    return {
      fileIds: validated.map((attachment) => {
        const id = resolved.get(attachment.clientId);
        if (id === undefined) {
          throw new Error(vscode.l10n.t('ClawAI attachment upload did not resolve a file ID.'));
        }
        return id;
      }),
      accept: () => {
        accepted = true;
      },
      rollback: async () => {
        if (accepted || created.length === 0) {
          return;
        }
        for (const entry of created) {
          if (this.cache.get(entry.clientId)?.id === entry.id) {
            this.cache.delete(entry.clientId);
          }
        }
        await Promise.allSettled(created.map((entry) => this.backend().deleteFile(entry.id)));
      },
    };
  }

  resetAccountState(): void {
    this.cache.clear();
  }

  private pruneCache(): void {
    while (this.cache.size > MAX_CACHED_ATTACHMENTS) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        return;
      }
      this.cache.delete(oldest);
    }
  }

  private progressEvent(progress: AttachmentUploadProgress): Record<string, unknown> {
    return {
      type: progress.status === 'uploading' ? 'ATTACHMENT_UPLOADING' : 'ATTACHMENT_UPLOADED',
      label:
        progress.status === 'uploading'
          ? vscode.l10n.t('Uploading attachment')
          : vscode.l10n.t('Attached file'),
      description: vscode.l10n.t(
        '{0} ({1}/{2})',
        progress.attachment.filename,
        progress.index + 1,
        progress.total,
      ),
    };
  }
}
