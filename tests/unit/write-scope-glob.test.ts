import { describe, expect, it } from 'vitest';

import {
  compileGlob,
  createWriteScope,
  normalizeGlob,
  pathInScope,
  scopeRefusal,
  writeScopeProblem,
} from '../../src/sdk/write-scope';
import { commandRefusal } from '../../src/sdk/write-scope-command';

describe('glob semantics', () => {
  it.each([
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/deep/a.ts', false],
    ['src/**', 'src/deep/er/a.ts', true],
    ['src/**', 'src', false],
    ['src/**/a.ts', 'src/a.ts', true],
    ['src/**/a.ts', 'src/x/y/a.ts', true],
    ['src/**/a.ts', 'src/x/b.ts', false],
    ['a?.ts', 'ab.ts', true],
    ['a?.ts', 'a/.ts', false],
    ['docs/', 'docs/x/y.md', true],
    ['./docs/*.md', 'docs/d.md', true],
    ['docs\\*.md', 'docs/d.md', true],
    ['a.b', 'axb', false],
    ['(x)+[y]', '(x)+[y]', true],
  ])('%s against %s is %s', (glob, value, expected) => {
    expect(compileGlob(glob, false).test(value)).toBe(expected);
  });

  it('is case-insensitive on win32 and darwin, sensitive on linux, by injection', () => {
    const lower = { scope: ['src/**'] };

    expect(pathInScope(createWriteScope(lower, { platform: 'win32' }) ?? fail(), 'SRC/A.ts')).toBe(
      true,
    );
    expect(pathInScope(createWriteScope(lower, { platform: 'darwin' }) ?? fail(), 'Src/a.ts')).toBe(
      true,
    );
    expect(pathInScope(createWriteScope(lower, { platform: 'linux' }) ?? fail(), 'SRC/A.ts')).toBe(
      false,
    );
    expect(pathInScope(createWriteScope(lower, { platform: 'linux' }) ?? fail(), 'src/A.ts')).toBe(
      true,
    );
  });

  it('normalizes a glob to forward slashes without a leading ./', () => {
    expect(normalizeGlob(' .\\src\\**\\*.ts ')).toBe('src/**/*.ts');
    expect(normalizeGlob('docs/')).toBe('docs/**');
  });
});

describe('createWriteScope', () => {
  it('is undefined when nothing restricts writes', () => {
    expect(createWriteScope({})).toBeUndefined();
    expect(createWriteScope({ scope: [], deny: [] })).toBeUndefined();
  });

  it('lets deny win over scope and refuses the workspace root and anything above it', () => {
    const scope = createWriteScope({ scope: ['src/**'], deny: ['src/secret/**'] }) ?? fail();

    expect(pathInScope(scope, 'src/a.ts')).toBe(true);
    expect(pathInScope(scope, 'src/secret/k.ts')).toBe(false);
    expect(pathInScope(scope, 'other.txt')).toBe(false);
    expect(pathInScope(scope, '')).toBe(false);
    expect(pathInScope(scope, '../src/a.ts')).toBe(false);
  });

  it('treats a deny alone as everywhere except there', () => {
    const scope = createWriteScope({ deny: ['docs/**'] }) ?? fail();

    expect(pathInScope(scope, 'src/a.ts')).toBe(true);
    expect(pathInScope(scope, 'docs/d.md')).toBe(false);
  });

  it('always refuses .git, at the root and below', () => {
    const scope = createWriteScope({ scope: ['**'] }) ?? fail();

    expect(pathInScope(scope, '.git/hooks/pre-commit')).toBe(false);
    expect(pathInScope(scope, 'pkg/.git/config')).toBe(false);
    expect(pathInScope(scope, 'pkg/.gitignore')).toBe(true);
  });

  it.each([['/etc/**'], ['C:/x/**'], ['../up/**'], ['a/../b'], ['']])(
    'rejects the unusable glob %j',
    (glob) => {
      expect(writeScopeProblem([glob], [])).toBeTypeOf('string');
      expect(() => createWriteScope({ scope: [glob] })).toThrow(RangeError);
    },
  );

  it('bounds the number and length of globs', () => {
    expect(
      writeScopeProblem(
        Array.from({ length: 65 }, () => 'a'),
        [],
      ),
    ).toContain('At most');
    expect(writeScopeProblem(['a'.repeat(201)], [])).toContain('characters');
  });

  it('words a refusal so the model can act on it', () => {
    const scope = createWriteScope({ scope: ['src/**', 'docs/**'] }) ?? fail();

    expect(scopeRefusal('workspace.file update', 'other.txt', scope)).toBe(
      'workspace.file update refused: "other.txt" is outside the write scope. You may only change: src/**, docs/**. If this file really needs to change, say so in your final report instead of editing it.',
    );
  });

  it('names at most eight globs and counts the rest', () => {
    const globs = Array.from({ length: 10 }, (_v, index) => `d${String(index)}/**`);
    const scope = createWriteScope({ scope: globs }) ?? fail();

    const message = scopeRefusal('workspace.file create', 'x', scope);

    expect(message).toContain('d7/**, and 2 more.');
    expect(message).not.toContain('d8/**');
  });
});

describe('commandRefusal', () => {
  it.each([
    ['rm', ['-rf', 'x']],
    ['C:\\tools\\RM.EXE', ['x']],
    ['mv', ['a', 'b']],
    ['del', ['a']],
    ['rmdir', ['a']],
    ['move', ['a', 'b']],
    ['cp', ['a', 'b']],
    ['copy', ['a', 'b']],
    ['xcopy', ['a', 'b']],
    ['robocopy', ['a', 'b']],
    ['tee', ['a']],
    ['sed', ['-i', 's/a/b/', 'f']],
    ['sed', ['-ni', 's/a/b/p', 'f']],
    ['sed', ['--in-place=.bak', 's/a/b/', 'f']],
    ['perl', ['-pi', '-e', 's/a/b/', 'f']],
    ['git', ['add', 'a']],
    ['git', ['commit', '-m', 'x']],
    ['git', ['checkout', '--', 'a']],
    ['git', ['reset', '--hard']],
    ['git', ['-C', '..', 'status']],
    ['git', ['branch', '-D', 'x']],
    ['git', ['remote', 'add', 'o', 'u']],
    ['git', ['diff', '--output=evil.txt']],
    ['git', ['diff', '--output', 'evil.txt']],
    ['git', ['fetch', '--upload-pack=calc']],
    ['git', ['push', '--receive-pack=calc']],
    ['git', ['fetch', '--upload-pack', 'calc']],
    ['git', ['log', '--exec=calc']],
    ['git', ['log', '-c', 'core.pager=calc']],
    ['git', ['log', '-ccore.pager=calc']],
    ['git', ['log', '--config-env=core.pager=X']],
    ['git', ['status', '--git-dir=..\\other']],
    ['git', ['status', '--work-tree', '..']],
    ['git', ['push', '--force']],
    ['git', ['push', '-f', 'origin', 'main']],
    ['git', ['push', '--force-with-lease']],
    ['git', ['push', '--force-with-lease=main:abc']],
    ['git', ['push', 'origin', '+main']],
    ['git', ['push', 'origin', '+main:main']],
  ])('refuses %s %j', (executable, args) => {
    expect(commandRefusal(executable, args)).toContain('workspace.command refused');
  });

  it.each([
    ['node', ['-e', '1']],
    ['npm', ['run', 'lint']],
    ['npx', ['prettier', '--check', 'a']],
    ['sed', ['-n', 's/a/b/p', 'f']],
    ['perl', ['-e', '1']],
    ['git', ['status']],
    ['git', ['diff', '--stat']],
    ['git', ['log', '-n', '3']],
    ['git', ['show', 'HEAD']],
    ['git', ['rev-parse', 'HEAD']],
    ['git', ['branch', '--list']],
    ['git', ['remote', '-v']],
    ['git', ['fetch']],
    ['git', ['pull']],
    ['git', ['push']],
    ['git', ['--version']],
  ])('allows %s %j', (executable, args) => {
    expect(commandRefusal(executable, args)).toBeUndefined();
  });
});

function fail(): never {
  throw new Error('expected a scope');
}
