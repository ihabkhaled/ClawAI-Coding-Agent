import { describe, expect, it } from 'vitest';

import { applyExactHunks } from '../../src/core/file-transaction';

// The read operation normalises a file to \n before the model sees it, so a
// model looking at a CRLF checkout is shown LF and echoes LF back in its hunk.
// Matching that against the raw bytes could never succeed: on Windows every
// patch failed with "Exact patch context is missing or ambiguous", which reads
// like the model got the context wrong when it was exactly right.
//
// Measured on the live repository: schema.prisma held 621 CRLF and zero bare
// LF, the model's LF hunk matched 0 times, and the CRLF form matched once.
describe('patching a file whose lines end in CRLF', () => {
  const crlf = 'model A {\r\n  id String\r\n}\r\n\r\nmodel B {\r\n  id String\r\n}\r\n';

  it('applies a hunk the model wrote with plain newlines', () => {
    const result = applyExactHunks(crlf, [
      {
        before: 'model B {\n  id String\n}\n',
        after: 'model B {\n  id String\n}\n\nmodel C {\n}\n',
      },
    ]);

    expect(result).toContain('model C');
  });

  it('keeps the document on CRLF instead of leaving mixed endings', () => {
    const result = applyExactHunks(crlf, [
      {
        before: 'model B {\n  id String\n}\n',
        after: 'model B {\n  id String\n}\n\nmodel C {\n}\n',
      },
    ]);

    expect(result.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('still patches an ordinary LF document', () => {
    const lf = 'model A {\n  id String\n}\n';
    const result = applyExactHunks(lf, [
      { before: '  id String\n', after: '  id String\n  n Int\n' },
    ]);

    expect(result).toBe('model A {\n  id String\n  n Int\n}\n');
    expect(result).not.toContain('\r');
  });

  it('accepts a hunk already written with CRLF', () => {
    const result = applyExactHunks(crlf, [
      { before: 'model B {\r\n  id String\r\n}\r\n', after: 'model B {\r\n}\r\n' },
    ]);

    expect(result).toContain('model B {\r\n}');
  });

  it('still refuses context that genuinely is not there', () => {
    expect(() => applyExactHunks(crlf, [{ before: 'model Z {\n}\n', after: 'x' }])).toThrow(
      'Exact patch context is missing or ambiguous',
    );
  });

  it('still refuses ambiguous context that appears twice', () => {
    expect(() => applyExactHunks(crlf, [{ before: '  id String\n', after: 'x' }])).toThrow(
      'Exact patch context is missing or ambiguous',
    );
  });
});
