import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashBrowserArtifact, type BrowserEvidence } from '../../src/core/browser-operation';
import {
  browserToolDefinition,
  BrowserToolExecutor,
} from '../../src/infrastructure/browser-tool-executor';
import {
  BrowserControllerService,
  type BrowserDriverPort,
} from '../../src/services/browser-controller-service';
import { MAX_BROWSER_OBSERVATION_UPLOAD_BYTES } from '../../src/services/browser-observation-upload.constants';
import { BrowserObservationUploader } from '../../src/services/browser-observation-uploader';
import { ServerReadinessService } from '../../src/services/server-readiness-service';

import type { ChatAttachment } from '../../src/core/chat-attachment';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type {
  BrowserObservationUploaderOptions,
  BrowserObservationUploadPort,
} from '../../src/services/browser-observation-upload.types';

// F030: an `observe` screenshot is uploaded for the next model turn when the
// selected model can see and zero retention is off, and never otherwise.

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const RELATIVE = 'session-0001/observe.png';

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claw-observe-'));
  await mkdir(join(root, 'session-0001'), { recursive: true });
  await writeFile(join(root, RELATIVE), PNG);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function evidence(overrides: Partial<BrowserEvidence> = {}): BrowserEvidence {
  return {
    evidenceId: 'browser-evidence:1',
    timestamp: '2026-09-30T08:00:00.000Z',
    operation: 'observe',
    artifactPath: RELATIVE,
    artifactHash: hashBrowserArtifact(PNG),
    consoleFailures: [],
    networkFailures: [],
    accessibilityViolations: 0,
    redactionApplied: true,
    ...overrides,
  };
}

function uploader(overrides: Partial<BrowserObservationUploaderOptions> = {}): {
  port: BrowserObservationUploader;
  upload: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
} {
  const upload = vi.fn(async (_attachments: ChatAttachment[]) => Promise.resolve(['file-shot-1']));
  const warn = vi.fn();
  const port = new BrowserObservationUploader({
    artifactRoot: root,
    acceptsImages: () => true,
    zeroRetention: () => false,
    uploads: { upload },
    readFile: async (path) => readFile(path),
    warn,
    ...overrides,
  });
  return { port, upload, warn };
}

describe('BrowserObservationUploader', () => {
  it('uploads the observed PNG through the attachment client', async () => {
    const { port, upload } = uploader();

    await expect(port.upload(evidence())).resolves.toBe('file-shot-1');

    expect(upload.mock.calls[0]?.[0]).toEqual([
      {
        clientId: 'browser-observation:browser-evidence:1',
        content: Buffer.from(PNG).toString('base64'),
        filename: 'browser-observe-observe.png',
        mimeType: 'image/png',
        sizeBytes: PNG.byteLength,
      },
    ]);
  });

  it('uploads nothing while zero retention is on', async () => {
    const { port, upload } = uploader({ zeroRetention: () => true });

    await expect(port.upload(evidence())).resolves.toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('uploads nothing when the selected model cannot see', async () => {
    const { port, upload } = uploader({ acceptsImages: () => false });

    await expect(port.upload(evidence())).resolves.toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('ignores other operations, missing artifacts and paths outside the root', async () => {
    const { port, upload } = uploader();

    await expect(port.upload(evidence({ operation: 'screenshot' }))).resolves.toBeUndefined();
    const withoutArtifact: BrowserEvidence = {
      evidenceId: 'browser-evidence:2',
      timestamp: '2026-09-30T08:00:00.000Z',
      operation: 'observe',
      consoleFailures: [],
      networkFailures: [],
      accessibilityViolations: 0,
      redactionApplied: true,
    };
    await expect(port.upload(withoutArtifact)).resolves.toBeUndefined();
    await expect(port.upload(evidence({ artifactPath: '../escape.png' }))).resolves.toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an over-bound file and one whose hash changed', async () => {
    const big = uploader({
      readFile: async () =>
        Promise.resolve(new Uint8Array(MAX_BROWSER_OBSERVATION_UPLOAD_BYTES + 1)),
    });
    await expect(big.port.upload(evidence())).resolves.toBeUndefined();
    expect(big.upload).not.toHaveBeenCalled();
    expect(big.warn).toHaveBeenCalledTimes(1);

    const tampered = uploader();
    await expect(
      tampered.port.upload(evidence({ artifactHash: `sha256:${'0'.repeat(64)}` })),
    ).resolves.toBeUndefined();
    expect(tampered.upload).not.toHaveBeenCalled();
  });

  it('turns an upload failure into no image, not a failed tool call', async () => {
    const { port, warn } = uploader({
      uploads: { upload: async () => Promise.reject(new Error('network down')) },
    });

    await expect(port.upload(evidence())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Browser observation not sent to the model: network down.');
  });

  it('rethrows when the run was cancelled mid-upload', async () => {
    const controller = new AbortController();
    const { port } = uploader({
      uploads: {
        upload: async () => {
          controller.abort(new Error('cancelled'));
          return Promise.reject(new Error('aborted'));
        },
      },
    });

    await expect(port.upload(evidence(), controller.signal)).rejects.toThrow('cancelled');
  });
});

describe('BrowserToolExecutor observe result fileIds', () => {
  const scope = {
    allowedOrigins: ['http://localhost:3000'],
    allowExternalNavigationWithApproval: false,
    allowDownloads: false,
    maxDownloadBytes: 1_000,
  };

  function executor(observations?: BrowserObservationUploadPort): BrowserToolExecutor {
    const driver: BrowserDriverPort = {
      execute: async () =>
        Promise.resolve({
          artifactPath: RELATIVE,
          artifactHash: hashBrowserArtifact(PNG),
          consoleFailures: [],
          networkFailures: [],
          accessibilityViolations: 0,
          structured: { observed: true },
        }),
      disposeSession: async () => Promise.resolve(),
    };
    const controller = new BrowserControllerService(driver, () => scope, {
      approveOrigin: async () => Promise.resolve(false),
    });
    const readiness = new ServerReadinessService(() => scope, {
      evidence: () => ({ running: false, logs: '' }),
    });
    return new BrowserToolExecutor(controller, readiness, observations);
  }

  function browserInvocation(operation: string): ToolInvocation {
    return {
      schemaVersion: '2.0',
      invocationId: 'invocation-0001',
      runId: 'runtime-0001',
      turnId: 'turn-00000001',
      toolName: browserToolDefinition.name,
      toolVersion: browserToolDefinition.version,
      operation,
      arguments: { sessionId: 'session-0001', artifactPath: 'observe.png' },
      targetId: 'target:browser',
      epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
      idempotencyKey: 'idempotency-0001',
      requestedAt: '2026-09-30T08:00:00.000Z',
    };
  }

  it('adds the uploaded id to the observe result', async () => {
    const upload = vi.fn(async () => Promise.resolve('file-shot-1'));

    const output = await executor({ upload }).execute(browserInvocation('observe'));

    expect(output.fileIds).toEqual(['file-shot-1']);
    expect(output.structured).toMatchObject({ result: { observed: true } });
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'observe', artifactPath: RELATIVE }),
      undefined,
    );
  });

  it('returns evidence only when nothing was uploaded or no uploader is wired', async () => {
    const none = await executor({ upload: async () => Promise.resolve(undefined) }).execute(
      browserInvocation('observe'),
    );
    const unwired = await executor().execute(browserInvocation('observe'));

    expect(none).not.toHaveProperty('fileIds');
    expect(unwired).not.toHaveProperty('fileIds');
  });

  it('never uploads for another operation', async () => {
    const upload = vi.fn(async () => Promise.resolve('file-shot-1'));

    const output = await executor({ upload }).execute(browserInvocation('screenshot'));

    expect(upload).not.toHaveBeenCalled();
    expect(output).not.toHaveProperty('fileIds');
  });
});
