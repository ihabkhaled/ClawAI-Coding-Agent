import type {
  DictationAdvice,
  DictationFailureKind,
  OsDictationHint,
} from './voice-dictation.types';

/** Longest single dictation the composer will record before it stops itself. */
export const DICTATION_MAX_SECONDS = 60;

const MAX_REPORTED_CODE_LENGTH = 64;

/**
 * Reduces a `SpeechRecognition` error code to the cases that need different
 * advice.
 *
 * The code arrives from a webview, so it is treated as untrusted text: anything
 * unrecognised becomes `other` rather than being echoed back to the user.
 * `no-speech` and `aborted` are deliberately absent. Neither is a failure of the
 * environment — the user was silent or pressed stop — and reporting them as
 * one would teach people that the feature is broken when it is not.
 */
export function classifyDictationError(code: string): DictationFailureKind {
  switch (code.slice(0, MAX_REPORTED_CODE_LENGTH)) {
    case 'unsupported':
      return 'unsupported';
    case 'not-allowed':
    case 'permission-denied':
      return 'permission-denied';
    case 'service-not-allowed':
    case 'network':
    case 'language-not-supported':
      return 'service-unreachable';
    case 'audio-capture':
      return 'no-microphone';
    default:
      return 'other';
  }
}

function osHintFor(platform: string): OsDictationHint {
  if (platform === 'win32') return 'windows-win-h';
  if (platform === 'darwin') return 'macos-fn-fn';
  return 'none';
}

/**
 * What the extension can honestly say when in-panel dictation is unavailable.
 *
 * Electron ships `webkitSpeechRecognition` without the cloud key it needs, and a
 * webview cannot always be granted the microphone, so failure is the ordinary
 * outcome in VS Code rather than an edge case. The fallback that does work is
 * the operating system's own dictation, which types into whatever has focus —
 * including this composer.
 */
export function dictationAdvice(platform: string, code: string): DictationAdvice {
  const failure = classifyDictationError(code);
  return {
    failure,
    osHint: osHintFor(platform),
    permanent: failure !== 'no-microphone' && failure !== 'other',
  };
}
