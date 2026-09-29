import { describe, expect, it } from 'vitest';

import { classifyRemoteCommand, parseRemoteCommand } from '../../src/core/remote-command-policy';

describe('parseRemoteCommand', () => {
  it('splits an executable and arguments, honouring quotes', () => {
    expect(parseRemoteCommand(' git  log --format="%h %s" ')).toEqual({
      kind: 'ok',
      executable: 'git',
      args: ['log', '--format=%h %s'],
    });
    expect(parseRemoteCommand("echo 'a b' ''")).toEqual({
      kind: 'ok',
      executable: 'echo',
      args: ['a b', ''],
    });
  });

  it.each([
    'ls | sh',
    'npm test && rm -rf /',
    'cat a > b',
    'echo $(whoami)',
    'echo `id`',
    'a; b',
    'echo ${HOME}',
    'line\nbreak',
  ])('refuses shell syntax: %s', (command) => {
    expect(parseRemoteCommand(command).kind).toBe('refused');
  });

  it('refuses empty, oversized, unbalanced and over-long argument lists', () => {
    expect(parseRemoteCommand('   ').kind).toBe('refused');
    expect(parseRemoteCommand('a'.repeat(4_097)).kind).toBe('refused');
    expect(parseRemoteCommand('echo "open').kind).toBe('refused');
    expect(parseRemoteCommand(`x ${Array.from({ length: 65 }, () => 'y').join(' ')}`).kind).toBe(
      'refused',
    );
  });
});

describe('classifyRemoteCommand', () => {
  it('treats allow-listed read-only calls as R1', () => {
    expect(classifyRemoteCommand('git', ['status'])).toBe('R1');
    expect(classifyRemoteCommand('GIT', ['log', '-n', '5'])).toBe('R1');
    expect(classifyRemoteCommand('ls', ['-la'])).toBe('R1');
    expect(classifyRemoteCommand('node', ['--version'])).toBe('R1');
  });

  it('treats everything else as R2 so a person must approve locally', () => {
    expect(classifyRemoteCommand('git', ['push'])).toBe('R2');
    expect(classifyRemoteCommand('git', [])).toBe('R2');
    expect(classifyRemoteCommand('git', ['branch', '-D', 'main'])).toBe('R2');
    expect(classifyRemoteCommand('git', ['remote', 'add', 'x', 'y'])).toBe('R2');
    expect(classifyRemoteCommand('npm', ['install'])).toBe('R2');
    expect(classifyRemoteCommand('rm', ['-rf', '.'])).toBe('R2');
    expect(classifyRemoteCommand('constructor', [])).toBe('R2');
    expect(classifyRemoteCommand('toString', [])).toBe('R2');
  });
});
