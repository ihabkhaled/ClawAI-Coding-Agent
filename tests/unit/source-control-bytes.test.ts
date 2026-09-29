import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['src', 'tests', 'scripts', 'media'];
const TEXT_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs', '.css', '.html', '.json', '.md']);
// Tab, line feed and carriage return are ordinary text. Every other byte below
// 0x20 is a control character that belongs in an escape, not in the file.
const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]);

function textFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return textFiles(full);
    return TEXT_EXTENSIONS.has(path.extname(entry)) ? [full] : [];
  });
}

/**
 * No source file carries a raw control byte.
 *
 * Two did — a NUL used as a join separator in `autosave-policy.ts` and
 * `sarif.ts`, typed as the byte itself rather than as `\u0000`. It ran
 * correctly, and it made both files binary to every tool that reads them:
 * `file` called them "data", grep skipped them, and GitHub showed their diffs
 * as "Binary files differ". A change to either could not be reviewed. The
 * escape produces the identical string at runtime.
 */
describe('source files', () => {
  it('contain no raw control bytes', () => {
    const offenders = ROOTS.flatMap(textFiles).flatMap((file) => {
      const bytes = readFileSync(file);
      const index = bytes.findIndex((byte) => byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte));
      if (index === -1) return [];
      const line = bytes.subarray(0, index).toString('utf8').split('\n').length;
      return [
        `${file}:${String(line)} byte 0x${bytes[index]?.toString(16).padStart(2, '0') ?? '??'}`,
      ];
    });

    expect(offenders).toEqual([]);
  });
});
