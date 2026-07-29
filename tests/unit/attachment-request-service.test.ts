import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: unknown[]) => {
      let result = message;
      values.forEach((value, index) => {
        result = result.replace(`{${String(index)}}`, String(value));
      });
      return result;
    },
  },
}));

import { AttachmentRequestService } from '../../src/services/attachment-request-service';

import type { ChatAttachment } from '../../src/core/chat-attachment';

function attachment(
  clientId = 'attachment-1',
  filename = 'claw.txt',
  value = 'claw',
): ChatAttachment {
  const bytes = Buffer.from(value);
  return {
    clientId,
    content: bytes.toString('base64'),
    filename,
    mimeType: 'text/plain',
    sizeBytes: bytes.byteLength,
  };
}

describe('AttachmentRequestService', () => {
  it('deletes a newly uploaded file when the owning request is rejected', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({ id: 'file-1' })),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );

    const lease = await service.acquire([attachment()], new AbortController().signal, 'request-1');
    await lease.rollback();

    expect(backend.deleteFile).toHaveBeenCalledWith('file-1');
  });

  it('reuses accepted file IDs for Retry without reuploading raw bytes', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({ id: 'file-1' })),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );
    const input = attachment();

    const first = await service.acquire([input], new AbortController().signal, 'request-1');
    first.accept();
    const retry = await service.acquire([input], new AbortController().signal, 'request-2');
    retry.accept();

    expect(first.fileIds).toEqual(['file-1']);
    expect(retry.fileIds).toEqual(['file-1']);
    expect(backend.uploadFile).toHaveBeenCalledOnce();
    expect(backend.deleteFile).not.toHaveBeenCalled();
  });

  it('reports uploading and uploaded progress with request ownership', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({ id: 'file-1' })),
    };
    const view = {
      postEvent: vi.fn(async () => undefined),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => view as never,
    );

    const lease = await service.acquire([attachment()], new AbortController().signal, 'request-1');
    lease.accept();

    expect(view.postEvent).toHaveBeenNthCalledWith(
      1,
      {
        description: 'claw.txt (1/1)',
        label: 'Uploading attachment',
        type: 'ATTACHMENT_UPLOADING',
      },
      'request-1',
    );
    expect(view.postEvent).toHaveBeenNthCalledWith(
      2,
      {
        description: 'claw.txt (1/1)',
        label: 'Attached file',
        type: 'ATTACHMENT_UPLOADED',
      },
      'request-1',
    );
  });

  it('keeps accepted and cached files when rollback is no longer request-owned', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({ id: 'file-1' })),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );
    const input = attachment();

    const accepted = await service.acquire(
      [input],
      new AbortController().signal,
      'request-accepted',
    );
    accepted.accept();
    await accepted.rollback();
    const cached = await service.acquire([input], new AbortController().signal, 'request-cached');
    await cached.rollback();

    expect(cached.fileIds).toEqual(['file-1']);
    expect(backend.uploadFile).toHaveBeenCalledOnce();
    expect(backend.deleteFile).not.toHaveBeenCalled();
  });

  it('never reuses backend file IDs after an account or endpoint boundary', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce({ id: 'account-a-file' })
        .mockResolvedValueOnce({ id: 'account-b-file' }),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );
    const input = attachment();
    const first = await service.acquire([input], new AbortController().signal, 'request-a');
    first.accept();

    service.resetAccountState();
    const second = await service.acquire([input], new AbortController().signal, 'request-b');

    expect(first.fileIds).toEqual(['account-a-file']);
    expect(second.fileIds).toEqual(['account-b-file']);
    expect(backend.uploadFile).toHaveBeenCalledTimes(2);
  });

  it('does not evict a newer cache entry when an older replacement request rolls back', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi
        .fn()
        .mockResolvedValueOnce({ id: 'file-original' })
        .mockResolvedValueOnce({ id: 'file-middle' })
        .mockResolvedValueOnce({ id: 'file-latest' }),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );
    const original = await service.acquire(
      [attachment('shared', 'claw.txt', 'original')],
      new AbortController().signal,
      'request-original',
    );
    original.accept();
    const middle = await service.acquire(
      [attachment('shared', 'claw.txt', 'middle')],
      new AbortController().signal,
      'request-middle',
    );
    const latest = await service.acquire(
      [attachment('shared', 'claw.txt', 'latest')],
      new AbortController().signal,
      'request-latest',
    );
    latest.accept();

    await middle.rollback();
    const retry = await service.acquire(
      [attachment('shared', 'claw.txt', 'latest')],
      new AbortController().signal,
      'request-retry',
    );

    expect(middle.fileIds).toEqual(['file-middle']);
    expect(retry.fileIds).toEqual(['file-latest']);
    expect(backend.uploadFile).toHaveBeenCalledTimes(3);
    expect(backend.deleteFile).toHaveBeenCalledWith('file-middle');
  });

  it('rejects a malformed upload response that omits the created file ID', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async () => ({}) as never),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );

    await expect(
      service.acquire([attachment()], new AbortController().signal, 'request-1'),
    ).rejects.toThrow('ClawAI attachment upload did not return a file ID.');
  });

  it('bounds the accepted attachment cache and reuploads its oldest entry after eviction', async () => {
    const backend = {
      deleteFile: vi.fn(async () => undefined),
      uploadFile: vi.fn(async (input: ChatAttachment) => ({ id: `file:${input.clientId}` })),
    };
    const service = new AttachmentRequestService(
      () => backend as never,
      () => null,
    );

    for (let index = 0; index < 101; index += 1) {
      const lease = await service.acquire(
        [attachment(`attachment-${String(index)}`, `file-${String(index)}.txt`)],
        new AbortController().signal,
        `request-${String(index)}`,
      );
      lease.accept();
    }
    const oldestRetry = await service.acquire(
      [attachment('attachment-0', 'file-0.txt')],
      new AbortController().signal,
      'request-retry',
    );

    expect(oldestRetry.fileIds).toEqual(['file:attachment-0']);
    expect(backend.uploadFile).toHaveBeenCalledTimes(102);
  });
});
