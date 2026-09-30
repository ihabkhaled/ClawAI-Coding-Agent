import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  FileType: { File: 1, Directory: 2 },
  Uri: {
    file: (path: string) => ({ path }),
    joinPath: (base: { path: string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join('/'),
    }),
  },
  workspace: {
    fs: {
      createDirectory: vi.fn(async () => undefined),
      stat: vi.fn(),
      writeFile: vi.fn(async () => undefined),
    },
  },
}));

import { workflowTemplateSchema } from '../../src/core/workflow-template';
import { VscodeWorkflowStore } from '../../src/infrastructure/vscode-workflow-store';
import {
  WorkflowStoreToolExecutor,
  workflowStoreToolDefinition,
} from '../../src/infrastructure/workflow-store-tool-executor';
import { RuntimePolicyV2Adapter } from '../../src/services/runtime-policy-v2-adapter';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';
import type { WorkflowTemplate } from '../../src/core/workflow-template';
import type { WorkflowTemplateWriteOutcome } from '../../src/infrastructure/workflow-store-tool-executor.types';

const EPOCHS = { account: 1, workspace: 1, target: 1, policy: 1 };

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: `invocation:workflows:${operation}`,
    runId: 'runtime:workflow-template',
    turnId: 'turn:workflow-template',
    toolName: workflowStoreToolDefinition.name,
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs: EPOCHS,
    idempotencyKey: `idempotency:workflows:${operation}`,
    requestedAt: '2026-09-30T12:00:00.000Z',
  } as ToolInvocation;
}

const fields = {
  name: 'Release notes',
  description: 'Draft release notes',
  instruction: 'Summarise the changes since the last tag.',
  steps: ['Read the git log', 'Group by type'],
  acceptanceChecks: ['Every commit is mentioned'],
};

function harness(outcome: WorkflowTemplateWriteOutcome = 'saved') {
  const writeTemplate = vi.fn(
    async (
      _template: WorkflowTemplate,
      _overwrite: boolean,
    ): Promise<WorkflowTemplateWriteOutcome> => outcome,
  );
  const store = {
    list: vi.fn(async () => []),
    read: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    writeTemplate,
  };
  return { writeTemplate, executor: new WorkflowStoreToolExecutor(store, () => EPOCHS) };
}

describe('runtime.workflows save-template', () => {
  it('declares the operation', () => {
    expect(workflowStoreToolDefinition.operations).toContain('save-template');
  });

  it('saves a template the loader schema accepts, refusing overwrite by default', async () => {
    const seat = harness();

    const output = await seat.executor.execute(invocation('save-template', fields));

    expect(output.structured).toEqual({ saved: true, name: 'Release notes', kind: 'template' });
    const [template, overwrite] = seat.writeTemplate.mock.calls[0] ?? [];
    expect(workflowTemplateSchema.parse(template)).toEqual(template);
    expect(overwrite).toBe(false);
  });

  it('passes overwrite through only when asked', async () => {
    const seat = harness();

    await seat.executor.execute(invocation('save-template', { ...fields, overwrite: true }));

    expect(seat.writeTemplate.mock.calls[0]?.[1]).toBe(true);
  });

  it('reports an existing file instead of replacing it', async () => {
    const seat = harness('exists');

    const output = await seat.executor.execute(invocation('save-template', fields));

    expect(output.structured).toEqual({ saved: false, name: 'Release notes', reason: 'exists' });
  });

  it('rejects a template the schema would refuse, and writes nothing', async () => {
    const seat = harness();

    await expect(
      seat.executor.execute(invocation('save-template', { ...fields, instruction: '' })),
    ).rejects.toThrow();
    await expect(
      seat.executor.execute(invocation('save-template', { ...fields, kind: 'graph' })),
    ).rejects.toThrow();
    expect(seat.writeTemplate).not.toHaveBeenCalled();
  });
});

describe('VscodeWorkflowStore.writeTemplate', () => {
  const template = workflowTemplateSchema.parse({ kind: 'template', ...fields });
  const store = new VscodeWorkflowStore({ workspaceRootUri: () => vscode.Uri.file('/repo') });

  beforeEach(() => {
    vi.mocked(vscode.workspace.fs.writeFile).mockClear();
    vi.mocked(vscode.workspace.fs.stat).mockReset();
  });

  it('writes a new file under .clawai/workflows with a slugged name', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockRejectedValue(new Error('missing'));

    await expect(store.writeTemplate(template, false)).resolves.toBe('saved');

    const [uri, bytes] = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0] ?? [];
    expect(uri).toEqual({ path: '/repo/.clawai/workflows/release-notes.json' });
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(template);
  });

  it('refuses an existing file unless overwrite is set', async () => {
    vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: 1,
    });

    await expect(store.writeTemplate(template, false)).resolves.toBe('exists');
    expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();

    await expect(store.writeTemplate(template, true)).resolves.toBe('saved');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('throws when there is no workspace folder', async () => {
    const orphan = new VscodeWorkflowStore({
      workspaceRootUri: () => {
        throw new Error('no workspace');
      },
    });

    await expect(orphan.writeTemplate(template, false)).rejects.toThrow('No workspace folder');
  });
});

describe('save-template permission gate', () => {
  function adapter(approve: () => Promise<boolean>) {
    return new RuntimePolicyV2Adapter(
      {
        accountId: () => 'account:test',
        backendOrigin: () => 'https://claw.local',
        workspaceId: () => 'workspace:test',
        workspaceRoot: () => 'D:/workspace',
        mode: () => 'ASK',
        workspaceTrusted: () => true,
        userPresent: () => true,
        organizationPolicy: () => undefined,
        approve,
      },
      {
        load: async () => ({
          deniedEffects: [],
          maximumRisk: 'R4',
          requireApproval: [],
          rules: [],
        }),
      },
    );
  }

  it('classifies saving a template as an R2 local mutation that asks first', async () => {
    const approve = vi.fn(async () => true);

    await expect(
      adapter(approve).evaluate(invocation('save-template', fields)),
    ).resolves.toMatchObject({ decision: 'allow' });
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({ risk: 'R2', effect: 'local-mutation', reversible: false }),
      undefined,
    );
  });

  it('denies the save when the person declines', async () => {
    await expect(
      adapter(async () => false).evaluate(invocation('save-template', fields)),
    ).resolves.toMatchObject({ decision: 'deny', code: 'USER_DENIED' });
  });
});
