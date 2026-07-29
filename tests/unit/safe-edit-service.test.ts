import { describe, expect, it, vi } from 'vitest';

import {
  SafeEditService,
  type EditPreview,
  type WorkspaceEditPort,
} from '../../src/services/safe-edit-service';

function workspacePort(trusted: boolean): WorkspaceEditPort {
  return {
    isTrusted: () => trusted,
    preview: vi.fn(async (): Promise<EditPreview[]> => [
      {
        path: 'src/a.ts',
        before: 'old',
        after: 'new',
      },
    ]),
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
});
