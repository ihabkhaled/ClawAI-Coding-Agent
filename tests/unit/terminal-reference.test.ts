import { describe, expect, it } from 'vitest';

import {
  MAX_TERMINAL_OUTPUT_BYTES,
  terminalReferenceBlock,
  trimTerminalOutput,
} from '../../src/core/terminal-reference';

describe('trimTerminalOutput', () => {
  it('keeps short output whole', () => {
    expect(trimTerminalOutput('done')).toEqual({ text: 'done', truncated: false });
  });

  it('keeps the end, because that is why the log is being referenced', () => {
    const long = `${'a'.repeat(MAX_TERMINAL_OUTPUT_BYTES)}THE ERROR`;

    const trimmed = trimTerminalOutput(long);

    expect(trimmed.truncated).toBe(true);
    expect(trimmed.text.endsWith('THE ERROR')).toBe(true);
  });

  it('never returns more than the budget', () => {
    const long = 'a'.repeat(MAX_TERMINAL_OUTPUT_BYTES * 2);

    expect(trimTerminalOutput(long).text.length).toBe(MAX_TERMINAL_OUTPUT_BYTES);
  });
});

describe('terminalReferenceBlock', () => {
  it('tags the output as terminal output rather than pasting it as prose', () => {
    const block = terminalReferenceBlock({ terminalName: 'bash', output: 'ok' });

    expect(block.startsWith('<terminal ')).toBe(true);
    expect(block.endsWith('</terminal>')).toBe(true);
  });

  it('carries the command and exit code when they are known', () => {
    const block = terminalReferenceBlock({
      terminalName: 'bash',
      output: 'ok',
      command: 'npm test',
      exitCode: 1,
    });

    expect(block).toContain('command="npm test"');
    expect(block).toContain('exitCode="1"');
  });

  it('leaves out what it does not know rather than inventing a placeholder', () => {
    const block = terminalReferenceBlock({ terminalName: 'bash', output: 'ok' });

    expect(block).not.toContain('command=');
    expect(block).not.toContain('exitCode=');
  });

  it('says when it truncated', () => {
    const block = terminalReferenceBlock({
      terminalName: 'bash',
      output: 'a'.repeat(MAX_TERMINAL_OUTPUT_BYTES + 1),
    });

    expect(block).toContain('truncated="true"');
  });

  it('cannot be escaped out of by a terminal name', () => {
    const block = terminalReferenceBlock({ terminalName: '"><script>', output: 'ok' });

    expect(block).not.toContain('<script>');
  });

  it('redacts secrets, because a terminal is where tokens end up', () => {
    const block = terminalReferenceBlock({
      terminalName: 'bash',
      output: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    });

    expect(block).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});
