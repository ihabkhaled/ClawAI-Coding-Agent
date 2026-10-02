/** What the opt-in tools read from the user's settings, live, so a change applies to the next call. */
export interface OptInToolSettings {
  /** `clawAI.tools.httpAllowHosts`: host rules `http.request` may reach. Empty means the tool is off. */
  readonly httpAllowHosts: () => readonly string[];
  /** `clawAI.tools.shellEnabled`: false means `workspace.shell` is off. */
  readonly shellEnabled: () => boolean;
  /** `clawAI.tools.shellDeny`: extra refusal patterns for scripts. */
  readonly shellDeny: () => readonly string[];
}
