import { describe, expect, it } from 'vitest';

import { createCommandTool } from '../../src/sdk/command-tool';
import { distinctExecutables, shellSyntaxArgument } from '../../src/sdk/command-tool-hints';
import { COMMAND_NO_SHELL_HINT } from '../../src/sdk/command-tool.constants';

const limits = (allowed: readonly string[]) => ({
  workspace: process.cwd(),
  allowedExecutables: allowed,
});

describe('command tool guidance', () => {
  it('lists the allowlist once and says there is no shell', () => {
    const tool = createCommandTool();

    let message = '';
    try {
      tool.execute('run', { executable: 'curl' }, limits(['node', 'npm', 'node', 'NODE', 'npx']));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('Command curl is not allowed. Allowed: node, npm, npx.');
    expect(message).toContain(COMMAND_NO_SHELL_HINT);
    expect(COMMAND_NO_SHELL_HINT).toBe(
      'Commands run WITHOUT a shell: no pipes, redirects, globbing or &&. Use workspace.file list/glob/search to inspect files, and run one program per call.',
    );
  });

  it('dedupes without reordering', () => {
    expect(distinctExecutables(['b', 'a', 'B', 'a', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it.each(['|', '>', '>>', '<', '2>&1', '2>', '&&', '||', '&', ';', '&>', ' | '])(
    'refuses the shell token %j as an argument without running anything',
    (token) => {
      const tool = createCommandTool();

      expect(() =>
        tool.execute(
          'run',
          { executable: 'node', arguments: ['-v', token, 'x'] },
          limits(['node']),
        ),
      ).toThrow(COMMAND_NO_SHELL_HINT);
    },
  );

  it('names the offending argument', () => {
    const tool = createCommandTool();

    expect(() =>
      tool.execute('run', { executable: 'node', arguments: ['a', '2>&1'] }, limits(['node'])),
    ).toThrow(/The argument "2>&1" is shell syntax/u);
  });

  it.each([
    [['-e', 'console.log(1 || 2)']],
    [['--flag=a|b']],
    [['a&&b']],
    [['>foo']],
    [['x;y']],
    [[]],
  ])('leaves ordinary arguments %j alone', (args) => {
    expect(shellSyntaxArgument(args)).toBeUndefined();
  });
});
