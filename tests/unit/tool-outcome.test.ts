import { describe, expect, it } from 'vitest';

import { toolOutcome } from '../../src/core/tool-outcome';
import { TOOL_REASON_MAX_LENGTH } from '../../src/core/tool-outcome.constants';

/**
 * What the panel can say about a call that has finished.
 *
 * Bytes and milliseconds answer "did anything come back" and nothing else. A
 * build that failed and a build that passed produce output of much the same
 * size in much the same time, so that pair cannot tell them apart — which is
 * the whole reason this exists.
 */
describe('toolOutcome', () => {
  it('reports an exit status, the one fact a byte count cannot imply', () => {
    expect(toolOutcome({ exitCode: 1 })).toEqual({
      kind: 'code',
      label: '',
      value: 1,
      reason: '',
    });
  });

  it('reports a successful exit as plainly as a failing one', () => {
    // Zero is a result, not an absence. Treating it as nothing would make a
    // passing command indistinguishable from one that reported no status.
    expect(toolOutcome({ exitCode: 0 }).kind).toBe('code');
    expect(toolOutcome({ exitCode: 0 }).value).toBe(0);
  });

  it('counts a list and says what was counted', () => {
    expect(toolOutcome({ services: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })).toEqual({
      kind: 'count',
      label: 'services',
      value: 3,
      reason: '',
    });
  });

  it('reports an empty list as zero rather than as nothing to say', () => {
    // "Found 0 files" is a useful answer and a different one from "the call
    // told us nothing".
    expect(toolOutcome({ discoveries: [] })).toEqual({
      kind: 'count',
      label: 'discoveries',
      value: 0,
      reason: '',
    });
  });

  it('prefers an exit status over a list when a result carries both', () => {
    expect(toolOutcome({ files: ['a', 'b'], exitCode: 2 }).kind).toBe('code');
  });

  it('explains a refusal, which otherwise looks exactly like a quiet success', () => {
    // Both finish in milliseconds with almost no output.
    expect(toolOutcome({ posted: false, reason: 'the run already ended' })).toEqual({
      kind: 'reason',
      label: '',
      value: 0,
      reason: 'the run already ended',
    });
  });

  it('collapses and shortens a long reason to one readable line', () => {
    const reason = `${'a refusal that goes on '.repeat(12)}end`;

    const outcome = toolOutcome({ reason });

    expect(outcome.reason.length).toBeLessThanOrEqual(TOOL_REASON_MAX_LENGTH);
    expect(outcome.reason.endsWith('…')).toBe(true);
  });

  it('ignores a reason key that is present but blank', () => {
    expect(toolOutcome({ reason: '   ' }).kind).toBe('none');
  });

  it('says nothing when the result has nothing worth saying', () => {
    expect(toolOutcome({ consulted: true })).toEqual({
      kind: 'none',
      label: '',
      value: 0,
      reason: '',
    });
  });

  it('survives a result that is not an object', () => {
    // This runs on whatever an executor returned. A throw here would take down
    // the stream that exists to report it.
    expect(toolOutcome(undefined).kind).toBe('none');
    expect(toolOutcome('done').kind).toBe('none');
    expect(toolOutcome(null).kind).toBe('none');
  });

  it('ignores a non-integer exit status rather than reporting a fraction', () => {
    expect(toolOutcome({ exitCode: 1.5 }).kind).toBe('none');
  });
});
