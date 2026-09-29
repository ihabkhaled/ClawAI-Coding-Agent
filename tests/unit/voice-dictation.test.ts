import { describe, expect, it } from 'vitest';

import {
  classifyDictationError,
  DICTATION_MAX_SECONDS,
  dictationAdvice,
} from '../../src/core/voice-dictation';

describe('classifyDictationError', () => {
  it.each([
    ['unsupported', 'unsupported'],
    ['not-allowed', 'permission-denied'],
    ['permission-denied', 'permission-denied'],
    ['service-not-allowed', 'service-unreachable'],
    ['network', 'service-unreachable'],
    ['language-not-supported', 'service-unreachable'],
    ['audio-capture', 'no-microphone'],
    ['something-new', 'other'],
    ['', 'other'],
  ])('maps %s to %s', (code, kind) => {
    expect(classifyDictationError(code)).toBe(kind);
  });

  it('never echoes an unrecognised or oversized code back', () => {
    expect(classifyDictationError(`network${'x'.repeat(500)}`)).toBe('other');
  });
});

describe('dictationAdvice', () => {
  it('suggests the platform dictation gesture', () => {
    expect(dictationAdvice('win32', 'network').osHint).toBe('windows-win-h');
    expect(dictationAdvice('darwin', 'network').osHint).toBe('macos-fn-fn');
    expect(dictationAdvice('linux', 'network').osHint).toBe('none');
  });

  it('marks environment failures permanent and device failures retryable', () => {
    expect(dictationAdvice('linux', 'not-allowed').permanent).toBe(true);
    expect(dictationAdvice('linux', 'unsupported').permanent).toBe(true);
    expect(dictationAdvice('linux', 'audio-capture').permanent).toBe(false);
    expect(dictationAdvice('linux', 'weird').permanent).toBe(false);
  });

  it('bounds a recording', () => {
    expect(DICTATION_MAX_SECONDS).toBeGreaterThan(0);
    expect(DICTATION_MAX_SECONDS).toBeLessThanOrEqual(120);
  });
});
