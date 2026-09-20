import { describe, expect, it, vi } from 'vitest';

// The runner builds a RuntimeUiProjector, which imports the editor API. The
// projector's own behaviour has its own suite; here it only has to exist.
vi.mock('vscode', () => ({ l10n: { t: (message: string) => message } }));

import { runQueuedAgent } from '../../src/services/run-queued-agent';

import type {
  QueuedAgentInput,
  QueuedAgentParts,
  QueuedAgentView,
} from '../../src/services/run-queued-agent.types';

function lease(fileIds: string[]): {
  fileIds: string[];
  accept: ReturnType<typeof vi.fn>;
  rollback: ReturnType<typeof vi.fn>;
} {
  return { fileIds, accept: vi.fn(), rollback: vi.fn(async () => undefined) };
}

function parts(overrides: {
  attachmentLease?: ReturnType<typeof lease>;
  execute?: ReturnType<typeof vi.fn>;
}): {
  parts: QueuedAgentParts;
  acquireAttachments: ReturnType<typeof vi.fn>;
  legacyExecute: ReturnType<typeof vi.fn>;
  studioExecute: ReturnType<typeof vi.fn>;
} {
  const acquireAttachments = vi.fn(async () => overrides.attachmentLease ?? lease([]));
  const legacyExecute = vi.fn(async () => undefined);
  const studioExecute = overrides.execute ?? vi.fn(async () => undefined);
  return {
    acquireAttachments,
    legacyExecute,
    studioExecute,
    parts: {
      workflows: {
        acquireAttachments,
        execute: legacyExecute,
        runtimeThread: vi.fn(async () => 'thread-1'),
      },
      studio: { execute: studioExecute },
      state: { snapshot: { runtime: { protocolSelection: { mode: 'runtime-v2' } } } },
    } as unknown as QueuedAgentParts,
  };
}

const view: QueuedAgentView = {
  view: () => null,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
};

function input(attachments: unknown[]): QueuedAgentInput {
  return {
    queuedInput: {
      content: 'Summarise the attached runbook.',
      attachments,
      selection: {},
    },
    requestId: 'request-1',
    signal: new AbortController().signal,
  } as unknown as QueuedAgentInput;
}

/**
 * Attaching a file used to cost the user the agent.
 *
 * Runtime V2 had no carrier for attachments, so any request with one was sent
 * down the legacy path instead — quietly, and with the tools left behind. The
 * run start now carries `fileIds`, so the file and the agent arrive together.
 */
describe('a queued agent run carries its attachments', () => {
  it('stays on Runtime V2 when a file is attached', async () => {
    const harness = parts({ attachmentLease: lease(['file-1']) });

    await runQueuedAgent(harness.parts, view, input([{ name: 'runbook.md' }]));

    expect(harness.studioExecute).toHaveBeenCalledTimes(1);
    expect(harness.legacyExecute).not.toHaveBeenCalled();
  });

  it('passes the uploaded file ids to the run', async () => {
    const harness = parts({ attachmentLease: lease(['file-1', 'file-2']) });

    await runQueuedAgent(harness.parts, view, input([{ name: 'a.md' }, { name: 'b.md' }]));

    expect(harness.studioExecute.mock.calls[0]?.[0]).toMatchObject({
      fileIds: ['file-1', 'file-2'],
    });
  });

  it('uploads nothing, and sends no fileIds, when there is no attachment', async () => {
    // An empty array would make every ordinary run look like one that had
    // attachments and lost them.
    const harness = parts({});

    await runQueuedAgent(harness.parts, view, input([]));

    expect(harness.acquireAttachments).not.toHaveBeenCalled();
    expect('fileIds' in (harness.studioExecute.mock.calls[0]?.[0] ?? {})).toBe(false);
  });

  it('accepts the lease only once the run has settled', async () => {
    const attachmentLease = lease(['file-1']);
    const harness = parts({ attachmentLease });

    await runQueuedAgent(harness.parts, view, input([{ name: 'runbook.md' }]));

    expect(attachmentLease.accept).toHaveBeenCalledTimes(1);
    expect(attachmentLease.rollback).not.toHaveBeenCalled();
  });

  it('rolls the upload back when the run throws, leaving no orphan', async () => {
    const attachmentLease = lease(['file-1']);
    const harness = parts({
      attachmentLease,
      execute: vi.fn(async () => {
        throw new Error('provider refused');
      }),
    });

    await expect(
      runQueuedAgent(harness.parts, view, input([{ name: 'runbook.md' }])),
    ).rejects.toThrow('provider refused');
    expect(attachmentLease.rollback).toHaveBeenCalledTimes(1);
    expect(attachmentLease.accept).not.toHaveBeenCalled();
  });
});
