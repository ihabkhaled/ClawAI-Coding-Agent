import { describe, expect, it } from 'vitest';

import { classifyRemoteCommand, parseRemoteCommand } from '../../src/core/remote-command-policy';

function risk(command: string): string {
  const parsed = parseRemoteCommand(command);
  if (parsed.kind !== 'ok') return 'refused';
  return classifyRemoteCommand(parsed.executable, parsed.args);
}

describe('remote command policy: read-only list cannot be turned into a write', () => {
  it.each([
    'git diff --output=/tmp/pwned',
    'git log --output=notes.txt',
    'git show --output=x HEAD',
    'git branch newbranch',
    'git branch -m old new',
    'git branch -f main HEAD~1',
    'git remote set-url origin https://evil.example/r.git',
    'git remote rm origin',
    'git remote prune origin',
    'git remote update',
  ])('needs local approval: %s', (command) => {
    expect(risk(command)).toBe('R2');
  });

  it.each([
    'git status',
    'git log -n 5',
    'git diff main..feature',
    'git branch',
    'git branch -a',
    'git branch --show-current',
    'git remote -v',
    'ls src',
    'npm ls',
  ])('stays read-only: %s', (command) => {
    expect(risk(command)).toBe('R1');
  });
});

describe('remote command policy: reads stay inside the workspace', () => {
  it.each([
    'git diff --no-index /etc/passwd /dev/null',
    'ls /etc',
    'ls ..',
    'ls ../../secrets',
    String.raw`ls ..\..\secrets`,
    String.raw`dir C:\Users`,
    'ls ~/.ssh',
    'git log --output=/x',
  ])('needs local approval: %s', (command) => {
    expect(risk(command)).toBe('R2');
  });
});
