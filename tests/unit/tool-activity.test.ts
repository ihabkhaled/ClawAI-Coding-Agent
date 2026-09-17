import { describe, expect, it } from 'vitest';

import { toolActivity } from '../../src/core/tool-activity';
import { TOOL_SUBJECT_MAX_LENGTH } from '../../src/core/tool-activity.constants';

/**
 * What the activity stream is able to say about a call.
 *
 * The stream exists so a person can watch the agent work: which file it read,
 * which command it ran, what it searched for. A line that says only
 * "workspace.files" is the failure this guards against, because it reads as
 * activity while telling the reader nothing.
 */
describe('toolActivity', () => {
  it('names the file a read is about', () => {
    const activity = toolActivity({
      toolName: 'workspace.files',
      operation: 'read',
      arguments: { path: 'src/app.ts' },
    });

    expect(activity).toEqual({
      toolName: 'workspace.files',
      operation: 'read',
      subject: 'src/app.ts',
      additional: 0,
    });
  });

  it('names the command a shell call runs', () => {
    const activity = toolActivity({
      toolName: 'workspace.command',
      arguments: { command: 'npm test' },
    });

    expect(activity.subject).toBe('npm test');
    expect(activity.operation).toBeUndefined();
  });

  it('names the query a search is for', () => {
    const activity = toolActivity({
      toolName: 'workspace.scan',
      arguments: { query: 'TODO' },
    });

    expect(activity.subject).toBe('TODO');
  });

  it('names the url a browser call opens', () => {
    const activity = toolActivity({
      toolName: 'workspace.web',
      arguments: { url: 'https://example.com/docs' },
    });

    expect(activity.subject).toBe('https://example.com/docs');
  });

  it('prefers the path when a call names both a path and a query', () => {
    // Order is the design. A call that names a file is about that file.
    const activity = toolActivity({
      toolName: 'workspace.intelligence',
      arguments: { query: 'rename symbol', path: 'src/app.ts' },
    });

    expect(activity.subject).toBe('src/app.ts');
  });

  it('describes a file transaction by its first operation and how many follow', () => {
    // The least informative possible line would sit on the most consequential
    // call in the run.
    const activity = toolActivity({
      toolName: 'workspace.files',
      operation: 'transaction',
      arguments: {
        operations: [
          { kind: 'create', path: 'src/a.ts' },
          { kind: 'create', path: 'src/b.ts' },
          { kind: 'delete', path: 'src/c.ts' },
        ],
      },
    });

    expect(activity.subject).toBe('src/a.ts');
    expect(activity.additional).toBe(2);
  });

  it('reads a plain list of paths as well as a list of operations', () => {
    const activity = toolActivity({
      toolName: 'workspace.files',
      arguments: { paths: ['src/a.ts', 'src/b.ts'] },
    });

    expect(activity.subject).toBe('src/a.ts');
    expect(activity.additional).toBe(1);
  });

  it('says which tool ran when the arguments name nothing recognisable', () => {
    // An empty subject is a real answer. Inventing a placeholder would make an
    // uninformative line look like an informative one.
    const activity = toolActivity({
      toolName: 'runtime.journal',
      arguments: { limit: 20 },
    });

    expect(activity).toEqual({ toolName: 'runtime.journal', subject: '', additional: 0 });
  });

  it('shortens a long path from the left, keeping the part that identifies it', () => {
    const path = `src/${'very-long-directory/'.repeat(8)}target-file.ts`;

    const activity = toolActivity({ toolName: 'workspace.files', arguments: { path } });

    expect(activity.subject.length).toBeLessThanOrEqual(TOOL_SUBJECT_MAX_LENGTH);
    expect(activity.subject.endsWith('target-file.ts')).toBe(true);
    expect(activity.subject.startsWith('…')).toBe(true);
  });

  it('collapses newlines so a multi-line command stays one line', () => {
    const activity = toolActivity({
      toolName: 'workspace.command',
      arguments: { command: 'npm run build\n && npm test' },
    });

    expect(activity.subject).toBe('npm run build && npm test');
  });

  it('ignores an argument that is present but blank', () => {
    const activity = toolActivity({
      toolName: 'workspace.files',
      arguments: { path: '   ', command: 'ls' },
    });

    expect(activity.subject).toBe('ls');
  });

  it('survives an invocation that is not shaped like one', () => {
    // This runs on whatever the model produced. A throw here would take down
    // the stream that exists to show what the model is doing.
    expect(toolActivity(undefined)).toEqual({ toolName: 'unknown', subject: '', additional: 0 });
    expect(toolActivity({ toolName: 7, arguments: 'nope' })).toEqual({
      toolName: 'unknown',
      subject: '',
      additional: 0,
    });
  });
});
