import { describe, expect, it } from 'vitest';

import { parseEditPlan } from '../../src/core/edit-plan';

describe('edit plan validation', () => {
  it('accepts bounded relative workspace edits', () => {
    expect(
      parseEditPlan({
        summary: 'Add a greeting',
        files: [
          {
            path: 'src/greeting.ts',
            operation: 'create',
            content: "export const greeting = 'hello';\n",
          },
        ],
      }),
    ).toMatchObject({
      summary: 'Add a greeting',
    });
  });

  it.each([
    '../outside.ts',
    '/absolute.ts',
    'C:\\outside.ts',
    '.git/config',
    '.env',
    'secrets/api-key.txt',
  ])('rejects dangerous edit target %s', (path) => {
    expect(() =>
      parseEditPlan({
        summary: 'Unsafe',
        files: [
          {
            path,
            operation: 'create',
            content: 'unsafe',
          },
        ],
      }),
    ).toThrow();
  });

  it('requires content for create/update and forbids it for delete', () => {
    expect(() =>
      parseEditPlan({
        summary: 'Missing content',
        files: [{ path: 'src/a.ts', operation: 'update' }],
      }),
    ).toThrow();
    expect(() =>
      parseEditPlan({
        summary: 'Delete with content',
        files: [{ path: 'src/a.ts', operation: 'delete', content: 'unexpected' }],
      }),
    ).toThrow();
  });

  it('normalizes the common model-supplied contents alias without weakening validation', () => {
    expect(
      parseEditPlan({
        summary: 'Create a greeting',
        files: [
          {
            path: 'app/greeting.js',
            operation: 'create',
            contents: 'console.log("hello");\n',
          },
        ],
      }).files,
    ).toEqual([
      {
        path: 'app/greeting.js',
        operation: 'create',
        content: 'console.log("hello");\n',
      },
    ]);

    expect(() =>
      parseEditPlan({
        summary: 'Ambiguous greeting',
        files: [
          {
            path: 'app/greeting.js',
            operation: 'create',
            content: 'console.log("one");\n',
            contents: 'console.log("two");\n',
          },
        ],
      }),
    ).toThrow();
  });

  it('accepts bounded development commands with safe workspace directories', () => {
    expect(
      parseEditPlan({
        summary: 'Create and verify the loop',
        files: [
          {
            path: 'app/loop.js',
            operation: 'create',
            content: 'console.log("ready");\n',
          },
        ],
        commands: [
          {
            command: 'node app/loop.js',
            cwd: '.',
            purpose: 'Run the generated file',
          },
          {
            command: 'npm test -- --runInBand',
            cwd: 'app',
            purpose: 'Verify the workspace tests',
          },
        ],
      }).commands,
    ).toHaveLength(2);
  });

  it('accepts command-only verification plans and conversational no-op plans', () => {
    expect(
      parseEditPlan({
        summary: 'Run the generated file',
        files: [],
        commands: [{ command: 'node app/loop.js', purpose: 'Verify output' }],
      }),
    ).toMatchObject({
      files: [],
      commands: [{ command: 'node app/loop.js' }],
    });
    expect(
      parseEditPlan({
        summary: 'Hi! How can I help with this workspace?',
        files: [],
        commands: [],
      }),
    ).toEqual({
      summary: 'Hi! How can I help with this workspace?',
      files: [],
      commands: [],
    });
  });

  it('normalizes a redundant model-supplied cwd prefix to the workspace root', () => {
    expect(
      parseEditPlan({
        summary: 'Run the generated file',
        files: [],
        commands: [
          {
            command: 'node app/for-loop.js',
            cwd: 'app',
            purpose: 'Verify output',
          },
        ],
      }).commands,
    ).toEqual([
      {
        command: 'node app/for-loop.js',
        purpose: 'Verify output',
      },
    ]);
  });

  it.each([
    'rm -rf .',
    'npm test && git push',
    'powershell -Command Get-ChildItem',
    'git reset --hard',
    'npm test\nwhoami',
  ])('discards unsafe or unbounded command %s', (command) => {
    expect(
      parseEditPlan({
        summary: 'Unsafe command',
        files: [{ path: 'app/a.js', operation: 'create', content: 'export {};\n' }],
        commands: [{ command, purpose: 'Unsafe' }],
      }).commands,
    ).toEqual([]);
  });

  it('keeps safe commands when unsafe model suggestions are discarded', () => {
    expect(
      parseEditPlan({
        summary: 'Create and verify',
        files: [{ path: 'app/a.js', operation: 'create', content: 'console.log("ok");\n' }],
        commands: [
          { command: 'touch app/a.js', purpose: 'Redundant shell mutation' },
          { command: 'node app/a.js', purpose: 'Run the generated file' },
        ],
      }).commands,
    ).toEqual([{ command: 'node app/a.js', purpose: 'Run the generated file' }]);
  });
});
