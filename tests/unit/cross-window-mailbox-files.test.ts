import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MAILBOX_FILE_SUFFIX,
  MAILBOX_TEMP_PREFIX,
} from '../../src/core/cross-window-mailbox.constants';
import {
  fileSize,
  isSafeKey,
  listFinal,
  readJson,
  remove,
  writeAtomic,
} from '../../src/infrastructure/cross-window-mailbox-files';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mbx-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('cross-window mailbox files', () => {
  it('accepts plain tokens as keys and refuses anything path-like', () => {
    expect(isSafeKey('win-1A')).toBe(true);
    expect(isSafeKey('a'.repeat(64))).toBe(true);
    for (const bad of ['', 'a'.repeat(65), '../x', 'a/b', 'a\\b', 'a.b', 'a b']) {
      expect(isSafeKey(bad)).toBe(false);
    }
  });

  it('writes atomically: one final file, no temp leftovers', async () => {
    const sub = join(dir, 'nested', 'inbox');
    expect(await writeAtomic(sub, 'm1', '{"a":1}')).toBe(true);
    expect(await readdir(sub)).toEqual([`m1${MAILBOX_FILE_SUFFIX}`]);
    expect(await readJson(join(sub, `m1${MAILBOX_FILE_SUFFIX}`))).toEqual({ a: 1 });
  });

  it('gives up and cleans its temp file when the target can never be replaced', async () => {
    // A non-empty directory squatting on the target name makes every rename fail.
    await mkdir(join(dir, `blocked${MAILBOX_FILE_SUFFIX}`, 'child'), { recursive: true });
    expect(await writeAtomic(dir, 'blocked', 'x')).toBe(false);
    const names = await readdir(dir);
    expect(names.filter((name) => name.startsWith(MAILBOX_TEMP_PREFIX))).toEqual([]);
  });

  it('lists final files only, and an absent directory as empty', async () => {
    await writeFile(join(dir, `a${MAILBOX_FILE_SUFFIX}`), '{}');
    await writeFile(join(dir, `${MAILBOX_TEMP_PREFIX}zzz${MAILBOX_FILE_SUFFIX}`), '{}');
    await writeFile(join(dir, 'notes.txt'), 'x');
    expect(await listFinal(dir)).toEqual([`a${MAILBOX_FILE_SUFFIX}`]);
    expect(await listFinal(join(dir, 'missing'))).toEqual([]);
  });

  it('reads malformed or missing JSON as undefined and sizes a missing file as 0', async () => {
    await writeFile(join(dir, 'bad.json'), '{oops');
    expect(await readJson(join(dir, 'bad.json'))).toBeUndefined();
    expect(await readJson(join(dir, 'nope.json'))).toBeUndefined();
    await writeFile(join(dir, 'five'), '12345');
    expect(await fileSize(join(dir, 'five'))).toBe(5);
    expect(await fileSize(join(dir, 'nope'))).toBe(0);
  });

  it('removes a file and tolerates a missing one or a file used as a parent', async () => {
    const file = join(dir, 'x');
    await writeFile(file, '1');
    await remove(file);
    expect(await fileSize(file)).toBe(0);
    await expect(remove(file)).resolves.toBeUndefined();
    await writeFile(join(dir, 'plain'), '1');
    await expect(remove(join(dir, 'plain', 'child'))).resolves.toBeUndefined();
  });
});
