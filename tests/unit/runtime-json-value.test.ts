import { describe, expect, it } from 'vitest';

import {
  MAX_RUNTIME_JSON_ARRAY_ITEMS,
  MAX_RUNTIME_JSON_ENTRIES,
  runtimeJsonObjectSchema,
} from '../../src/core/runtime/runtime-json-value';

describe('runtime JSON bounds', () => {
  // `workspace.files` sends a source file as one array entry per line, so the
  // array bound decides the largest file the agent can write at all.
  it('admits a source file longer than the object-entry cap', () => {
    const contentLines = Array.from(
      { length: MAX_RUNTIME_JSON_ENTRIES * 9 },
      (_, index) => `const line${String(index)} = 1;`,
    );

    expect(runtimeJsonObjectSchema.safeParse({ contentLines }).success).toBe(true);
  });

  it('still refuses an array beyond the pathological item ceiling', () => {
    const contentLines = Array.from({ length: MAX_RUNTIME_JSON_ARRAY_ITEMS + 1 }, () => 'x');

    expect(runtimeJsonObjectSchema.safeParse({ contentLines }).success).toBe(false);
  });

  it('keeps the tighter object-entry ceiling', () => {
    const entries = Object.fromEntries(
      Array.from({ length: MAX_RUNTIME_JSON_ENTRIES + 1 }, (_, index) => [
        `key${String(index)}`,
        index,
      ]),
    );

    expect(runtimeJsonObjectSchema.safeParse({ nested: entries }).success).toBe(false);
  });
});
