import { describe, expect, it } from 'vitest';

import {
  assembleContextEnvelope,
  MAX_BACKEND_MESSAGE_BYTES,
} from '../../src/core/context-envelope';

describe('assembleContextEnvelope', () => {
  it('includes only complete files that fit and reports the transport receipt', () => {
    const result = assembleContextEnvelope({
      content: 'Question',
      context: [
        { content: 'export {};\n', path: 'src/a".ts' },
        { content: 'x'.repeat(MAX_BACKEND_MESSAGE_BYTES), path: 'src/large.ts' },
      ],
      contextReceipt: {
        excluded: [{ path: 'dist/out.js', reason: 'excluded' }],
        included: ['src/a".ts', 'src/large.ts'],
        totalBytes: MAX_BACKEND_MESSAGE_BYTES + 11,
        truncated: false,
      },
      header: '\n\nUntrusted workspace context:',
    });

    expect(result.content).toContain('path="src/a&quot;.ts"');
    expect(result.content).not.toContain('src/large.ts');
    expect(new TextEncoder().encode(result.content).byteLength).toBeLessThanOrEqual(
      MAX_BACKEND_MESSAGE_BYTES,
    );
    expect(result.contextReceipt).toEqual({
      excluded: [
        { path: 'dist/out.js', reason: 'excluded' },
        { path: 'src/large.ts', reason: 'limit' },
      ],
      included: ['src/a".ts'],
      totalBytes: 11,
      truncated: true,
    });
  });

  it('truncates multibyte user content on a valid UTF-8 boundary', () => {
    const result = assembleContextEnvelope({
      content: '🙂'.repeat(MAX_BACKEND_MESSAGE_BYTES),
      context: [],
      header: '',
    });

    expect(new TextEncoder().encode(result.content).byteLength).toBeLessThanOrEqual(
      MAX_BACKEND_MESSAGE_BYTES,
    );
    expect(result.content.endsWith('�')).toBe(false);
  });
});
