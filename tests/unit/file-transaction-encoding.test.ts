import { describe, expect, it } from 'vitest';

import {
  decodeBase64Text,
  normalizeTransactionEncoding,
} from '../../src/core/file-transaction-encoding';

const encode = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

// Writing code means putting source into a JSON string, and every quote, brace
// and newline has to survive the model's own escaping. It did not: a live
// mission created an 808-byte SQL file successfully and then failed every
// attempt at a TypeScript file, because the request stopped being parseable
// JSON before it arrived. Base64 has nothing JSON must escape.
describe('base64 file content', () => {
  it('decodes source that would have broken the JSON envelope', () => {
    const source = 'import { X } from "y";\n\nexport class A {\n  b(): void {}\n}\n';

    expect(decodeBase64Text(encode(source), 'contentBase64')).toBe(source);
  });

  it('substitutes contentBase64 into content for a create', () => {
    const source = 'export const a = "b";\n';
    const normalized = normalizeTransactionEncoding({
      transactionId: 't1',
      summary: 'add a file',
      operations: [
        { kind: 'create', rootKey: 'workspace-1', path: 'a.ts', contentBase64: encode(source) },
      ],
    }) as { operations: { content?: string; contentBase64?: string }[] };

    expect(normalized.operations[0]?.content).toBe(source);
    expect(normalized.operations[0]?.contentBase64).toBeUndefined();
  });

  it('substitutes both halves of a patch hunk', () => {
    const normalized = normalizeTransactionEncoding({
      transactionId: 't1',
      summary: 'edit',
      operations: [
        {
          kind: 'patch',
          rootKey: 'workspace-1',
          path: 'a.ts',
          hunks: [{ beforeBase64: encode('old {\n}'), afterBase64: encode('new {\n}') }],
        },
      ],
    }) as { operations: { hunks: { before?: string; after?: string }[] }[] };

    expect(normalized.operations[0]?.hunks[0]?.before).toBe('old {\n}');
    expect(normalized.operations[0]?.hunks[0]?.after).toBe('new {\n}');
  });

  it('leaves a plain-text transaction exactly as it was', () => {
    const plain = {
      transactionId: 't1',
      summary: 'add',
      operations: [{ kind: 'create', rootKey: 'workspace-1', path: 'a.ts', content: 'x' }],
    };

    expect(normalizeTransactionEncoding(plain)).toEqual(plain);
  });

  it('refuses both forms of the same field rather than guessing', () => {
    expect(() =>
      normalizeTransactionEncoding({
        operations: [{ kind: 'create', content: 'x', contentBase64: encode('y') }],
      }),
    ).toThrow(/not both/iu);
  });

  it('refuses a value that is not base64', () => {
    expect(() => decodeBase64Text('not base64 !!!', 'contentBase64')).toThrow(/not valid base64/iu);
  });

  it('passes through anything that is not a transaction', () => {
    expect(normalizeTransactionEncoding('nonsense')).toBe('nonsense');
    expect(normalizeTransactionEncoding({ operations: 'not-an-array' })).toEqual({
      operations: 'not-an-array',
    });
  });
});
