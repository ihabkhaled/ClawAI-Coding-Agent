import { describe, expect, it, vi } from 'vitest';

import {
  SafeEditService,
  type EditReview,
  type WorkspaceEditPort,
} from '../../src/services/safe-edit-service';

function workspacePort(trusted: boolean): WorkspaceEditPort {
  return {
    isTrusted: () => trusted,
    preview: vi.fn(async (): Promise<EditReview> => ({
      workspaceFolderUri: 'memory:///workspace',
      previews: [
        {
          path: 'src/a.ts',
          before: 'old',
          after: 'new',
        },
      ],
    })),
    applyAtomically: vi.fn(async () => true),
  };
}

const plan = {
  summary: 'Update a',
  files: [
    {
      path: 'src/a.ts',
      operation: 'update' as const,
      content: 'new',
    },
  ],
};

describe('SafeEditService', () => {
  it('rejects a massive legacy edit-plan shrink during an explicit small-patch run', async () => {
    const before = Array.from({ length: 200 }, (_, index) => `line ${String(index)}`).join('\n');
    const workspace = workspacePort(true);
    vi.mocked(workspace.preview).mockResolvedValue({
      workspaceFolderUri: 'file:///workspace',
      previews: [{ path: 'src/large.ts', before, after: 'export interface Added {}' }],
    });
    const service = new SafeEditService(workspace, async () => true);
    await expect(
      service.previewAndApply(
        plan,
        undefined,
        undefined,
        'ONE FILE ONLY: src/large.ts. Add ONLY one exported interface; do not change anything else.',
      ),
    ).rejects.toThrow('destructive whole-file replacement');
    expect(workspace.applyAtomically).not.toHaveBeenCalled();
  });
  it('serializes complete preview and apply transactions', async () => {
    let finishFirstPreview: (() => void) | undefined;
    let previewCalls = 0;
    const events: string[] = [];
    const workspace: WorkspaceEditPort = {
      isTrusted: () => true,
      preview: async (): Promise<EditReview> => {
        previewCalls += 1;
        events.push(`preview:${String(previewCalls)}`);
        if (previewCalls === 1) {
          await new Promise<void>((resolve) => {
            finishFirstPreview = resolve;
          });
        }
        return {
          workspaceFolderUri: 'memory:///workspace',
          previews: [{ path: 'src/a.ts', before: 'old', after: 'new' }],
        };
      },
      applyAtomically: async () => {
        events.push('apply');
        return true;
      },
    };
    const service = new SafeEditService(workspace, async () => true);

    const first = service.previewAndApply(plan, new AbortController().signal);
    const second = service.previewAndApply(plan, new AbortController().signal);
    await vi.waitFor(() => {
      expect(events).toEqual(['preview:1']);
    });
    finishFirstPreview?.();
    await Promise.all([first, second]);

    expect(events).toEqual(['preview:1', 'apply', 'preview:2', 'apply']);
  });

  it('does not undo while another workspace mutation is active', async () => {
    let finishPreview: (() => void) | undefined;
    const undoLast = vi.fn(async () => true);
    const workspace: WorkspaceEditPort = {
      isTrusted: () => true,
      preview: async () => {
        await new Promise<void>((resolve) => {
          finishPreview = resolve;
        });
        return {
          workspaceFolderUri: 'memory:///workspace',
          previews: [{ path: 'src/a.ts', before: 'old', after: 'new' }],
        };
      },
      applyAtomically: async () => true,
      undoLast,
    };
    const service = new SafeEditService(workspace, async () => true);

    const applying = service.previewAndApply(plan);
    await vi.waitFor(() => {
      expect(finishPreview).toBeTypeOf('function');
    });
    const undoing = service.undoLast();
    await Promise.resolve();

    expect(undoLast).not.toHaveBeenCalled();
    finishPreview?.();
    await applying;
    await expect(undoing).resolves.toBe(true);
    expect(undoLast).toHaveBeenCalledOnce();
  });

  it('previews first and applies only after an immediate explicit approval', async () => {
    const workspace = workspacePort(true);
    const confirm = vi.fn(async () => true);
    const service = new SafeEditService(workspace, confirm);

    await expect(service.previewAndApply(plan)).resolves.toEqual({
      applied: true,
      previews: expect.any(Array),
    });
    expect(workspace.preview).toHaveBeenCalledBefore(confirm);
    expect(confirm).toHaveBeenCalledBefore(vi.mocked(workspace.applyAtomically));
    expect(workspace.applyAtomically).toHaveBeenCalledWith(
      plan,
      expect.objectContaining({ workspaceFolderUri: 'memory:///workspace' }),
      undefined,
    );
  });

  it('never applies in an untrusted workspace or after rejection', async () => {
    const untrusted = workspacePort(false);
    const untrustedService = new SafeEditService(untrusted, async () => true);
    await expect(untrustedService.previewAndApply(plan)).rejects.toThrow(/trust/iu);
    expect(untrusted.applyAtomically).not.toHaveBeenCalled();

    const rejected = workspacePort(true);
    const rejectedService = new SafeEditService(rejected, async () => false);
    await expect(rejectedService.previewAndApply(plan)).resolves.toMatchObject({
      applied: false,
    });
    expect(rejected.applyAtomically).not.toHaveBeenCalled();
  });

  it('keeps the exact staged preview identity with the edit result', async () => {
    const workspace = workspacePort(true);
    const service = new SafeEditService(workspace, async () => ({
      approved: true,
      previewId: 'preview-for-this-run',
    }));

    await expect(service.previewAndApply(plan)).resolves.toMatchObject({
      applied: true,
      previewId: 'preview-for-this-run',
    });
  });

  it('cannot apply after cancellation while final review is open', async () => {
    const workspace = workspacePort(true);
    let finishReview: ((approved: boolean) => void) | undefined;
    const service = new SafeEditService(
      workspace,
      () =>
        new Promise<boolean>((resolve) => {
          finishReview = resolve;
        }),
    );
    const controller = new AbortController();
    const cancellation = new Error('Account changed.');
    const applying = service.previewAndApply(plan, controller.signal);
    await vi.waitFor(() => {
      expect(finishReview).toBeTypeOf('function');
    });

    controller.abort(cancellation);
    finishReview?.(true);

    await expect(applying).rejects.toBe(cancellation);
    expect(workspace.applyAtomically).not.toHaveBeenCalled();
  });

  it('reports a completed atomic commit even if cancellation arrives while it is applying', async () => {
    const workspace = workspacePort(true);
    let finishApply: ((applied: boolean) => void) | undefined;
    vi.mocked(workspace.applyAtomically).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finishApply = resolve;
      }),
    );
    const controller = new AbortController();
    const service = new SafeEditService(workspace, async () => true);
    const applying = service.previewAndApply(plan, controller.signal);
    await vi.waitFor(() => {
      expect(workspace.applyAtomically).toHaveBeenCalledOnce();
    });

    controller.abort(new Error('Workspace changed.'));
    finishApply?.(true);

    await expect(applying).resolves.toMatchObject({ applied: true });
  });
});
