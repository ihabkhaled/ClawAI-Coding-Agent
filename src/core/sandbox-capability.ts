import type { SandboxGuarantees, SandboxKind, SandboxProbe } from './sandbox-capability.types';

/**
 * What each sandbox actually promises.
 *
 * `none` is a real entry rather than an absence, and it is the important one.
 * The extension bounds commands — output size, wall clock, no shell, no
 * chaining — but bounding is not isolation, and a run that reported "sandboxed"
 * on a host with no sandbox would be lying in the one place a reader is
 * deciding whether to approve something.
 */
const GUARANTEES: Readonly<Record<SandboxKind, Omit<SandboxGuarantees, 'kind'>>> = {
  none: {
    filesystemJail: false,
    networkIsolation: false,
    processContainment: true,
    summary:
      'No OS sandbox on this host. Commands are bounded — no shell, no chaining, capped output and wall clock — but they run with your own permissions.',
  },
  'linux-bubblewrap': {
    filesystemJail: true,
    networkIsolation: true,
    processContainment: true,
    summary:
      'bubblewrap is available: commands can be given a filesystem jail and no network namespace.',
  },
  'macos-seatbelt': {
    filesystemJail: true,
    networkIsolation: true,
    processContainment: true,
    summary:
      'sandbox-exec is available: commands can be confined to the workspace with network denied.',
  },
  'windows-job-object': {
    filesystemJail: false,
    networkIsolation: false,
    processContainment: true,
    summary:
      'Windows job objects contain a command and its children, but do not jail the filesystem or block the network.',
  },
};

/**
 * The strongest isolation this host can offer.
 *
 * Deliberately conservative. A helper on PATH is evidence it can be invoked,
 * not that it will work — a container without the right capabilities has
 * `bwrap` and cannot use it — so the caller still has to probe before relying
 * on it. What this refuses to do is claim a sandbox the host has no mechanism
 * for at all, which is the failure that matters: an unsandboxed command
 * reported as sandboxed is an approval given on a false premise.
 */
export function chooseSandbox(probe: SandboxProbe): SandboxKind {
  if (probe.platform === 'linux' && probe.available.includes('bwrap')) {
    return 'linux-bubblewrap';
  }
  if (probe.platform === 'darwin' && probe.available.includes('sandbox-exec')) {
    return 'macos-seatbelt';
  }
  if (probe.platform === 'win32') {
    // Job objects need no helper: they are the OS, and Node already contains a
    // child's tree on Windows. It is the weakest entry here and is still worth
    // naming, because "contained but not jailed" is a different promise from
    // nothing at all.
    return 'windows-job-object';
  }
  return 'none';
}

export function sandboxGuarantees(kind: SandboxKind): SandboxGuarantees {
  return { kind, ...GUARANTEES[kind] };
}

/**
 * Whether a caller asking for isolation can be told yes.
 *
 * Both halves must hold. A sandbox that jails the filesystem but leaves the
 * network open does not isolate a command that exfiltrates; one that blocks the
 * network but not the filesystem does not isolate a command that reads a key.
 * Asking for "isolated" and getting half of it is worse than being told no,
 * because the caller stops looking.
 */
export function isolatesCommands(kind: SandboxKind): boolean {
  const guarantees = GUARANTEES[kind];
  return guarantees.filesystemJail && guarantees.networkIsolation;
}
