import { describe, expect, it } from 'vitest';

import { SseDecoder } from '../../src/core/sse-decoder';

describe('SseDecoder', () => {
  it('decodes events split across network chunks and ignores comments', () => {
    const decoder = new SseDecoder();

    expect(decoder.push(': keepalive\n\ndata: {"type":"delta","text":"hel')).toEqual([]);
    expect(decoder.push('lo"}\n\ndata: {"type":"done"}\n\n')).toEqual([
      {
        type: 'delta',
        text: 'hello',
      },
      {
        type: 'done',
      },
    ]);
  });

  it('rejects oversized events before parsing them', () => {
    const decoder = new SseDecoder(20);

    expect(() => decoder.push(`data: ${'x'.repeat(30)}\n\n`)).toThrow();
  });
});
