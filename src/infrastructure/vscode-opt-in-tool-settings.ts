import * as vscode from 'vscode';

import { readOptInToolValues, type OptInToolValues } from '../core/opt-in-tool-settings';

import type { OptInToolSettings } from './opt-in-tools.types';

/** The opt-in tool settings as they are right now, from the user's own settings only. */
export function currentOptInToolValues(): OptInToolValues {
  const configuration = vscode.workspace.getConfiguration('clawAI');
  return readOptInToolValues((key) => {
    const inspected = configuration.inspect(key);
    return inspected?.globalValue ?? inspected?.defaultValue;
  });
}

/** Live getters, so a change in settings applies to the next tool call. */
export function liveOptInToolSettings(): OptInToolSettings {
  return {
    httpAllowHosts: () => currentOptInToolValues().httpAllowHosts,
    shellEnabled: () => currentOptInToolValues().shellEnabled,
    shellDeny: () => currentOptInToolValues().shellDeny,
  };
}
