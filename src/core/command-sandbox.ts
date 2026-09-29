import type {
  CommandSandboxDecision,
  CommandSandboxHost,
  CommandSandboxMechanism,
  CommandSandboxPlan,
  CommandSandboxReport,
  CommandSandboxSettings,
} from './command-sandbox.types';

function mechanismAvailable(
  mechanism: CommandSandboxMechanism,
  settings: CommandSandboxSettings,
  host: CommandSandboxHost,
): boolean {
  if (mechanism === 'bubblewrap') return host.platform === 'linux' && host.bubblewrap;
  if (mechanism === 'seatbelt') return host.platform === 'darwin' && host.sandboxExec;
  return host.docker && settings.dockerImage.trim().length > 0;
}

/** Strongest first: an OS sandbox needs no image and keeps the host toolchain. */
const AUTO_ORDER: readonly CommandSandboxMechanism[] = ['bubblewrap', 'seatbelt', 'docker'];

/**
 * Which mechanism confines the next command, or why none does.
 *
 * Windows has no entry. Job objects contain a process tree but jail neither the
 * filesystem nor the network, and Node cannot create an AppContainer, so on
 * Windows the only real sandbox is a container — and `auto` says `none` rather
 * than dressing containment up as isolation.
 */
export function decideCommandSandbox(
  settings: CommandSandboxSettings,
  host: CommandSandboxHost,
): CommandSandboxDecision {
  if (settings.mode === 'off') return { mechanism: 'none', reason: 'disabled' };
  if (settings.mode === 'auto') {
    const chosen = AUTO_ORDER.find((mechanism) => mechanismAvailable(mechanism, settings, host));
    return chosen === undefined
      ? { mechanism: 'none', reason: 'unavailable' }
      : { mechanism: chosen };
  }
  return mechanismAvailable(settings.mode, settings, host)
    ? { mechanism: settings.mode }
    : { mechanism: 'none', reason: 'required-unavailable' };
}

const NONE_DETAIL = {
  disabled:
    'Command sandbox is off (clawAI.commandSandbox.mode). The command is bounded but runs with your own permissions.',
  unavailable:
    'No sandbox mechanism on this host (no bubblewrap, no sandbox-exec, no docker image configured). The command is bounded but runs with your own permissions.',
  'required-unavailable':
    'The configured sandbox mechanism is not available on this host, so the command was refused.',
} as const;

const MECHANISM_DETAIL: Readonly<Record<CommandSandboxMechanism, string>> = {
  bubblewrap:
    'bubblewrap: writes confined to the workspace and temp, credential stores masked, own PID namespace.',
  seatbelt:
    'sandbox-exec: writes confined to the workspace and temp, credential stores unreadable.',
  docker:
    'docker: only the workspace is mounted, all capabilities dropped, no new privileges, PID limit.',
};

export function commandSandboxReport(plan: CommandSandboxPlan): CommandSandboxReport {
  const { decision, settings } = plan;
  if (decision.mechanism === 'none') {
    return {
      sandbox: 'none',
      filesystem: 'unconfined',
      network: 'on',
      detail: NONE_DETAIL[decision.reason],
    };
  }
  return {
    sandbox: decision.mechanism,
    filesystem: 'workspace',
    network: settings.allowNetwork ? 'on' : 'off',
    detail: MECHANISM_DETAIL[decision.mechanism],
  };
}

/** A named mechanism the host lacks must stop the command, not downgrade it. */
export function sandboxRefusesCommand(decision: CommandSandboxDecision): boolean {
  return decision.mechanism === 'none' && decision.reason === 'required-unavailable';
}
