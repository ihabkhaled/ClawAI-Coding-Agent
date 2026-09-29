import type { PluginFailureCode } from './plugin-manifest.types';

/**
 * A refusal with a reason the user can act on.
 *
 * The code is what the interface translates; the detail is what a manifest
 * author needs, and is shown untranslated because it quotes their own file.
 */
export class PluginFailure extends Error {
  constructor(
    readonly code: PluginFailureCode,
    readonly detail = '',
  ) {
    super(detail === '' ? code : `${code}: ${detail}`);
    this.name = 'PluginFailure';
  }
}
