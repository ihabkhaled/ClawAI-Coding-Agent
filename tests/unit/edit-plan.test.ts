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
});
