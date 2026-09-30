import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isPathInside } from '../../src/core/path-inside';
import { isContainedRelativePath } from '../../src/core/plugin-path';

describe('isPathInside', () => {
  it('accepts a child, the root itself, and a drive root on Windows', () => {
    expect(isPathInside('C:\\work', 'C:\\work\\a\\b', path.win32)).toBe(true);
    expect(isPathInside('C:\\work', 'C:\\work', path.win32)).toBe(true);
    expect(isPathInside('C:\\', 'C:\\work', path.win32)).toBe(true);
  });

  it('accepts anything under the POSIX root', () => {
    expect(isPathInside('/', '/etc/passwd', path.posix)).toBe(true);
  });

  it('refuses a sibling that shares a prefix, and other drives', () => {
    expect(isPathInside('C:\\work', 'C:\\work-evil\\a', path.win32)).toBe(false);
    expect(isPathInside('C:\\work', 'D:\\work\\a', path.win32)).toBe(false);
    expect(isPathInside('/work', '/work-evil/a', path.posix)).toBe(false);
    expect(isPathInside('/work', '/work/../etc', path.posix)).toBe(false);
  });

  it('is case-insensitive on Windows only', () => {
    expect(isPathInside('C:\\Work', 'c:\\work\\a', path.win32)).toBe(true);
    expect(isPathInside('/Work', '/work/a', path.posix)).toBe(false);
  });

  it('keeps a child whose name merely starts with two dots', () => {
    expect(isPathInside('/work', '/work/..cache/x', path.posix)).toBe(true);
  });

  it('refuses UNC paths on another share', () => {
    expect(isPathInside('\\\\srv\\a', '\\\\srv\\b\\x', path.win32)).toBe(false);
    expect(isPathInside('\\\\srv\\a', '\\\\srv\\a\\x', path.win32)).toBe(true);
  });
});

describe('isContainedRelativePath on Windows-hostile names', () => {
  it('refuses reserved device names, with or without an extension', () => {
    for (const name of ['CON', 'nul.txt', 'a/aux', 'a/COM1.json', 'lpt9', 'Con.d/x']) {
      expect(isContainedRelativePath(name)).toBe(false);
    }
  });

  it('refuses trailing dots and spaces that Windows silently strips', () => {
    for (const name of ['plugin.json.', 'a/b ', 'a. /b']) {
      expect(isContainedRelativePath(name)).toBe(false);
    }
  });

  it('refuses control characters and wildcard characters', () => {
    for (const name of ['a\u0001b', 'a?b', 'a*b', 'a<b', 'a|b', 'a"b']) {
      expect(isContainedRelativePath(name)).toBe(false);
    }
  });

  it('still accepts ordinary paths and near-miss names', () => {
    for (const name of ['plugin.json', 'skills/a/SKILL.md', 'console.md', 'a/.hidden', 'com10']) {
      expect(isContainedRelativePath(name)).toBe(true);
    }
  });
});
