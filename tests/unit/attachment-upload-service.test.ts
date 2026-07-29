import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { AttachmentUploadService } from '../../src/services/attachment-upload-service';

import type { ChatAttachment } from '../../src/core/chat-attachment';

function attachment(filename: string, clientId: string): ChatAttachment {
  const content = Buffer.from(filename).toString('base64');
  return {
    clientId,
    content,
    filename,
    mimeType: 'text/plain',
    sizeBytes: Buffer.byteLength(filename),
  };
}

describe('AttachmentUploadService', () => {
  it('uploads validated attachments sequentially and reports each request-owned step', async () => {
    let active = 0;
    let peak = 0;
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async (input: ChatAttachment) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        return { id: `file:${input.filename}` };
      }),
    };
    const progress = vi.fn();
    const service = new AttachmentUploadService(() => backend);

    await expect(
      service.upload(
        [attachment('first.txt', 'first'), attachment('second.txt', 'second')],
        new AbortController().signal,
        progress,
      ),
    ).resolves.toEqual(['file:first.txt', 'file:second.txt']);

    expect(peak).toBe(1);
    expect(progress.mock.calls.map(([entry]) => entry.status)).toEqual([
      'uploading',
      'uploaded',
      'uploading',
      'uploaded',
    ]);
  });

  it('validates the complete batch before starting a remote upload', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({ id: 'file-1' })),
    };
    const service = new AttachmentUploadService(() => backend);
    const invalid = attachment('../secret.txt', 'unsafe');

    await expect(
      service.upload([invalid], new AbortController().signal, () => undefined),
    ).rejects.toThrow();
    expect(backend.uploadFile).not.toHaveBeenCalled();
  });

  it('rolls back completed uploads when a later attachment fails', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce({ id: 'file:first.txt' })
        .mockRejectedValueOnce(new Error('upload failed')),
    };
    const service = new AttachmentUploadService(() => backend);

    await expect(
      service.upload(
        [attachment('first.txt', 'first'), attachment('second.txt', 'second')],
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toThrow('upload failed');

    expect(backend.deleteFile).toHaveBeenCalledOnce();
    expect(backend.deleteFile).toHaveBeenCalledWith('file:first.txt');
  });
});
