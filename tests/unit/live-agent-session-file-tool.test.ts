import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkspace, toolExecutor } from '../../scripts/live-agent-session.mjs';

const workspaces: string[] = [];
const fresh = (): string => {
  const workspace = createWorkspace({ 'README.md': '# x\n' });
  workspaces.push(workspace);
  return workspace;
};

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { force: true, recursive: true });
});

describe('live harness flat workspace.file create', () => {
  it('writes contentLines instead of silently creating an empty file', async () => {
    const workspace = fresh();
    const execute = toolExecutor(workspace);
    await Promise.resolve(
      execute('workspace.file', 'create', { path: 'TOKEN.txt', contentLines: ['7734'] }),
    );
    expect(readFileSync(path.join(workspace, 'TOKEN.txt'), 'utf8')).toBe('7734');
  });

  it('refuses a create that carried no content at all', async () => {
    const workspace = fresh();
    const execute = toolExecutor(workspace);
    await expect(
      Promise.resolve().then(() => execute('workspace.file', 'create', { path: 'x.txt' })),
    ).rejects.toThrow(/no content/u);
  });

  it('still writes a plain content string', async () => {
    const workspace = fresh();
    const execute = toolExecutor(workspace);
    await Promise.resolve(execute('workspace.file', 'create', { path: 'a.txt', content: 'a' }));
    expect(readFileSync(path.join(workspace, 'a.txt'), 'utf8')).toBe('a');
  });
});
