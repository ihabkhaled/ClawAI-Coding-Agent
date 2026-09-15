import { describe, expect, it } from 'vitest';

import {
  applyCellEdit,
  cellText,
  parseNotebook,
  serializeNotebook,
} from '../../src/core/notebook-document';

const SAMPLE =
  '{\n  "cells": [\n    {\n      "cell_type": "markdown",\n      "source": [\n        "# Title\\n"\n      ],\n      "metadata": {\n        "tags": [\n          "intro"\n        ]\n      }\n    },\n    {\n      "cell_type": "code",\n      "source": "print(1)",\n      "metadata": {},\n      "outputs": [\n        {\n          "output_type": "stream",\n          "text": "1"\n        }\n      ],\n      "execution_count": 3\n    }\n  ],\n  "metadata": {\n    "kernelspec": {\n      "name": "python3"\n    },\n    "widgets": {\n      "state": {\n        "a": 1\n      }\n    }\n  },\n  "nbformat": 4,\n  "nbformat_minor": 5\n}\n';

function roundTrip(text: string): unknown {
  return JSON.parse(serializeNotebook(parseNotebook(text)));
}

describe('parseNotebook and serializeNotebook', () => {
  it('round-trips a notebook without changing it', () => {
    expect(serializeNotebook(parseNotebook(SAMPLE))).toBe(SAMPLE);
  });

  it('keeps notebook metadata it has no opinion about', () => {
    const back = roundTrip(SAMPLE) as { metadata: { widgets: unknown } };

    expect(back.metadata.widgets).toEqual({ state: { a: 1 } });
  });

  it('keeps per-cell fields it does not model', () => {
    const back = roundTrip(SAMPLE) as { cells: { metadata?: unknown }[] };

    expect(back.cells[0]?.metadata).toEqual({ tags: ['intro'] });
  });

  it('refuses a file that is not a notebook', () => {
    expect(() => parseNotebook('{"nope": true}')).toThrow();
  });
});

describe('cellText', () => {
  it('reads a source stored as lines', () => {
    expect(cellText(['a\n', 'b'])).toBe('a\nb');
  });

  it('reads a source stored as one string', () => {
    expect(cellText('a\nb')).toBe('a\nb');
  });
});

describe('applyCellEdit', () => {
  it('replaces a cell source', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), {
      kind: 'replace',
      index: 1,
      source: 'print(2)',
    });

    expect(cellText(edited.notebook.cells[1]?.source ?? '')).toBe('print(2)');
  });

  it('clears outputs when the code changes, because a stale output is a lie', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), {
      kind: 'replace',
      index: 1,
      source: 'print(2)',
    });

    expect(edited.notebook.cells[1]?.outputs).toEqual([]);
    expect(edited.notebook.cells[1]?.execution_count).toBeNull();
  });

  it('keeps the source representation the file already used', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), {
      kind: 'replace',
      index: 0,
      source: 'line one\nline two',
    });

    expect(Array.isArray(edited.notebook.cells[0]?.source)).toBe(true);
  });

  it('inserts a cell at an index', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), {
      kind: 'insert',
      index: 1,
      cellType: 'code',
      source: 'print(0)',
    });

    expect(edited.notebook.cells).toHaveLength(3);
    expect(cellText(edited.notebook.cells[1]?.source ?? '')).toBe('print(0)');
  });

  it('allows inserting at the very end', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), {
      kind: 'insert',
      index: 2,
      cellType: 'markdown',
      source: 'done',
    });

    expect(edited.notebook.cells).toHaveLength(3);
  });

  it('deletes a cell', () => {
    const edited = applyCellEdit(parseNotebook(SAMPLE), { kind: 'delete', index: 0 });

    expect(edited.notebook.cells).toHaveLength(1);
    expect(edited.notebook.cells[0]?.cell_type).toBe('code');
  });

  it('refuses an index outside the notebook rather than clamping it', () => {
    const parsed = parseNotebook(SAMPLE);

    expect(() => applyCellEdit(parsed, { kind: 'replace', index: 12, source: 'x' })).toThrow(
      /No cell at index 12/u,
    );
    expect(() => applyCellEdit(parsed, { kind: 'delete', index: -1 })).toThrow();
    expect(() =>
      applyCellEdit(parsed, { kind: 'insert', index: 99, cellType: 'code', source: 'x' }),
    ).toThrow();
  });

  it('leaves the original notebook untouched', () => {
    const parsed = parseNotebook(SAMPLE);

    applyCellEdit(parsed, { kind: 'delete', index: 0 });

    expect(parsed.notebook.cells).toHaveLength(2);
  });
});
