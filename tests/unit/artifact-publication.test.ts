import { describe, expect, it, vi } from 'vitest';

import { publishArtifact } from '../../src/backend/artifact-client';
import { BackendRequestError } from '../../src/backend/backend-errors';
import { prepareArtifact } from '../../src/core/artifact-publication';
import { MAX_ARTIFACT_BYTES } from '../../src/core/artifact-publication.constants';
import {
  ArtifactToolExecutor,
  artifactToolDefinition,
} from '../../src/infrastructure/artifact-tool-executor';

import type { ArtifactUpload } from '../../src/backend/artifact-client';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

describe('prepareArtifact', () => {
  it('passes clean text through untouched with a hash and mime type', () => {
    const result = prepareArtifact({ path: 'docs/report.md', content: '# Hello\n' });
    expect(result).toMatchObject({
      status: 'ready',
      filename: 'report.md',
      mimeType: 'text/markdown',
      redactedLines: 0,
      previewTruncated: false,
    });
    expect(result.status === 'ready' && result.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('masks recognised secrets and counts the lines changed', () => {
    const result = prepareArtifact({
      path: 'notes.txt',
      content: 'fine\ncall with Bearer abc.def.ghi\nend',
    });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.content).not.toContain('abc.def.ghi');
    expect(result.redactedLines).toBe(1);
  });

  it('blocks a credential the redactor cannot mask', () => {
    const key = ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' ');
    const result = prepareArtifact({ path: 'page.html', content: `<pre>${key}</pre>` });
    expect(result).toMatchObject({ status: 'blocked', reason: 'secret-remains' });
  });

  it('blocks binary and oversized files, and defaults unknown types to text', () => {
    expect(prepareArtifact({ path: 'a.bin', content: 'a\u0000b' })).toMatchObject({
      reason: 'binary',
    });
    expect(
      prepareArtifact({ path: 'big.txt', content: 'a'.repeat(MAX_ARTIFACT_BYTES + 1) }),
    ).toMatchObject({ reason: 'too-large' });
    expect(prepareArtifact({ path: 'Makefile', content: 'all:' })).toMatchObject({
      mimeType: 'text/plain',
    });
  });

  it('truncates only the preview, never the upload body', () => {
    const result = prepareArtifact({ path: 'a.txt', content: 'z'.repeat(5_000) });
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.previewTruncated).toBe(true);
    expect(result.content).toHaveLength(5_000);
  });
});

const upload: ArtifactUpload = {
  filename: 'a.md',
  mimeType: 'text/markdown',
  content: 'x',
  sha256: 'h',
};

describe('publishArtifact', () => {
  it('returns the hosted address on success', async () => {
    const request = vi.fn(async () => ({ id: 'art_1', url: 'https://claw.local/a/art_1' }));
    const outcome = await publishArtifact(request as never, upload);
    expect(request).toHaveBeenCalledWith(
      '/artifacts',
      expect.anything(),
      expect.objectContaining({ method: 'POST', body: upload }),
    );
    expect(outcome).toEqual({
      status: 'published',
      id: 'art_1',
      url: 'https://claw.local/a/art_1',
    });
  });

  it('reports a missing backend route instead of a fake success', async () => {
    const request = vi.fn(async () => {
      throw new BackendRequestError('Not found', 404, false);
    });
    const outcome = await publishArtifact(request, upload, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'route-missing' });
  });

  it('propagates every other failure', async () => {
    const request = vi.fn(async () => {
      throw new BackendRequestError('boom', 500, true);
    });
    await expect(publishArtifact(request as never, upload)).rejects.toThrow('boom');
  });
});

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:artifact',
    runId: 'runtime:artifact',
    turnId: 'turn:artifact',
    toolName: 'workspace.artifact',
    toolVersion: '1.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:artifact',
    requestedAt: '2026-09-29T00:00:00.000Z',
  } as ToolInvocation;
}

describe('ArtifactToolExecutor', () => {
  const args = { rootKey: 'workspace', path: 'out/report.md', title: 'Report' };

  it('advertises publish as a publication-class operation', () => {
    expect(artifactToolDefinition.operations).toEqual(['prepare', 'publish']);
    expect(artifactToolDefinition.riskClasses).toContain('publish');
  });

  it('prepare previews the scrubbed text and uploads nothing', async () => {
    const publisher = { publish: vi.fn() };
    const subject = new ArtifactToolExecutor(
      { read: async () => 'key: Bearer abc.def' },
      publisher,
    );
    const output = await subject.execute(invocation('prepare', args));
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(output.structured).toMatchObject({ status: 'ready', uploaded: false, redactedLines: 1 });
    expect(JSON.stringify(output.structured)).not.toContain('abc.def');
    expect(output.structured).not.toHaveProperty('content');
  });

  it('publish uploads the scrubbed body, not the raw file', async () => {
    const publisher = {
      publish: vi.fn(async () => ({ status: 'published' as const, id: 'a', url: 'https://x/a' })),
    };
    const subject = new ArtifactToolExecutor({ read: async () => 'Bearer abc.def' }, publisher);
    const output = await subject.execute(invocation('publish', args));
    const sent = publisher.publish.mock.calls[0] as unknown as [ArtifactUpload];
    expect(sent[0].content).not.toContain('abc.def');
    expect(sent[0]).toMatchObject({ filename: 'report.md', title: 'Report' });
    expect(output.structured).toMatchObject({
      status: 'published',
      uploaded: true,
      url: 'https://x/a',
    });
  });

  it('publish reports a missing route as not uploaded', async () => {
    const publisher = {
      publish: vi.fn(async () => ({ status: 'route-missing' as const, detail: 'no route' })),
    };
    const subject = new ArtifactToolExecutor({ read: async () => 'hello' }, publisher);
    const output = await subject.execute(invocation('publish', args));
    expect(output.structured).toMatchObject({ status: 'route-missing', uploaded: false });
  });

  it('never uploads a blocked file and rejects unknown operations', async () => {
    const publisher = { publish: vi.fn() };
    const subject = new ArtifactToolExecutor({ read: async () => 'a\u0000b' }, publisher);
    const output = await subject.execute(invocation('publish', args));
    expect(output.structured).toMatchObject({ status: 'blocked', reason: 'binary' });
    expect(publisher.publish).not.toHaveBeenCalled();
    await expect(subject.execute(invocation('delete', args))).rejects.toThrow('operation');
    await expect(
      subject.execute({
        ...invocation('publish', args),
        toolName: 'workspace.other',
      }),
    ).rejects.toThrow('Unknown artifact tool');
  });
});
