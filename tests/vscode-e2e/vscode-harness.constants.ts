/**
 * Flags that make a launch reproducible rather than personal.
 *
 * Workspace Trust is disabled because the lane opens a throwaway folder and a
 * modal trust prompt would block every test. Other extensions are disabled so a
 * failure is attributable to this one. Telemetry, updates and the welcome page
 * are off because none of them are under test and all of them add noise.
 */
export const VSCODE_LAUNCH_ARGUMENTS: readonly string[] = [
  '--disable-workspace-trust',
  '--disable-extensions-except=clawai.clawai-coding-agent',
  '--disable-telemetry',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  '--no-sandbox',
  '--disable-gpu',
];
