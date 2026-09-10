import { describe, expect, it } from 'vitest';

import { parseSlashInvocation, parseSlashQuery } from '../../src/core/slash-command';

describe('parseSlashInvocation', () => {
  it('reads a bare command', () => {
    expect(parseSlashInvocation('/review')).toEqual({ name: 'review', argumentText: '' });
  });

  it('reads a command with arguments', () => {
    expect(parseSlashInvocation('/review src/app.ts and be strict')).toEqual({
      name: 'review',
      argumentText: 'src/app.ts and be strict',
    });
  });

  it('is not fooled by a path', () => {
    expect(parseSlashInvocation('look at src/app.ts')).toBeUndefined();
  });

  it('is not fooled by a lone slash', () => {
    expect(parseSlashInvocation('/')).toBeUndefined();
  });

  it('matches a command however it was capitalised', () => {
    expect(parseSlashInvocation('/Review x')?.name).toBe('review');
  });
});

describe('parseSlashQuery', () => {
  it('offers completion while the name is being typed', () => {
    expect(parseSlashQuery('/rev', 4)).toBe('rev');
  });

  it('offers everything the moment a slash is typed', () => {
    expect(parseSlashQuery('/', 1)).toBe('');
  });

  it('stops completing once an argument is being typed', () => {
    expect(parseSlashQuery('/review src', 11)).toBeUndefined();
  });

  it('completes from the caret rather than the end of the line', () => {
    expect(parseSlashQuery('/review', 4)).toBe('rev');
  });

  it('offers nothing for ordinary text', () => {
    expect(parseSlashQuery('review this', 6)).toBeUndefined();
  });
});
