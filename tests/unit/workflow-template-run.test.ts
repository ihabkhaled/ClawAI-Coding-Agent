import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => message },
  FileType: { File: 1, Directory: 2 },
  Uri: {
    file: (path: string) => ({ path }),
    joinPath: (base: { path: string }, ...parts: string[]) => ({
      path: [base.path, ...parts].join('/'),
    }),
  },
  window: {
    showInformationMessage: vi.fn(async () => undefined),
    showQuickPick: vi.fn(),
    showInputBox: vi.fn(),
  },
  workspace: {
    fs: {
      readDirectory: vi.fn(),
      readFile: vi.fn(),
    },
  },
}));

import { workflowTemplateSchema } from '../../src/core/workflow-template';
import { VscodeWorkflowStore } from '../../src/infrastructure/vscode-workflow-store';
import { automationCommands } from '../../src/services/automation-commands';
import { flagshipImplementationGraph } from '../helpers/flagship-stage';

import type { ScheduledTaskService } from '../../src/services/scheduled-task-service';

const template = workflowTemplateSchema.parse({
  kind: 'template',
  name: 'Release notes',
  description: 'Draft release notes',
  instruction: 'Summarise the changes.',
  requestPrompt: 'Which version?',
});
const graphWorkflow = {
  name: 'Graph one',
  description: 'A graph',
  savedAt: '2026-09-29T00:00:00.000Z',
  graph: flagshipImplementationGraph(),
};

function commands(templates = [template]) {
  const run = vi.fn(async () => undefined);
  const schedules = (): ScheduledTaskService => {
    throw new Error('not used');
  };
  return {
    run,
    automation: automationCommands({
      schedules,
      workflows: async () => [graphWorkflow],
      templates: async () => templates,
      run,
    }),
  };
}

describe('running user-defined workflow templates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('asks for the request with the template wording, then runs it', async () => {
    const { run, automation } = commands();
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const list = await items;
      return list[1];
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('v2.0');
    await automation.runSavedWorkflow();
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Release notes', prompt: 'Which version?' }),
    );
    expect(run).toHaveBeenCalledWith(expect.stringContaining('Request: v2.0'));
  });

  it('cancels when the request box is dismissed', async () => {
    const { run, automation } = commands();
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (await items)[1]);
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    await automation.runSavedWorkflow();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a template without a request prompt straight away', async () => {
    const { run, automation } = commands([{ ...template, requestPrompt: undefined }]);
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (await items)[1]);
    await automation.runSavedWorkflow();
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(expect.stringContaining('Summarise the changes.'));
  });

  it('still runs a saved graph by its plain name', async () => {
    const { run, automation } = commands();
    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => (await items)[0]);
    await automation.runSavedWorkflow();
    expect(run).toHaveBeenCalledWith(expect.stringContaining('name "Graph one"'));
  });

  it('reports nothing to run when there are neither graphs nor templates', async () => {
    const run = vi.fn(async () => undefined);
    await automationCommands({
      schedules: () => {
        throw new Error('not used');
      },
      workflows: async () => [],
      run,
    }).runSavedWorkflow();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('No saved workflows.');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('VscodeWorkflowStore templates', () => {
  const files = { workspaceRootUri: () => vscode.Uri.file('/root') };
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

  it('lists templates and graphs from the same folder without mixing them', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue([
      ['release.json', vscode.FileType.File],
      ['graph.json', vscode.FileType.File],
      ['broken.json', vscode.FileType.File],
      ['notes.md', vscode.FileType.File],
    ]);
    vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
      if (uri.path.endsWith('release.json')) return encode(template);
      if (uri.path.endsWith('graph.json')) return encode(graphWorkflow);
      return new TextEncoder().encode('{not json');
    });
    const store = new VscodeWorkflowStore(files);
    expect((await store.listTemplates()).map(({ name }) => name)).toEqual(['Release notes']);
    expect((await store.list()).map(({ name }) => name)).toEqual(['Graph one']);
  });

  it('lists no templates when the folder is missing', async () => {
    vi.mocked(vscode.workspace.fs.readDirectory).mockRejectedValue(new Error('ENOENT'));
    const store = new VscodeWorkflowStore(files);
    expect(await store.listTemplates()).toEqual([]);
  });
});
