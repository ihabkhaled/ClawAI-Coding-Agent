const recorded: unknown[] = [];
let installed: ((reason: unknown) => void) | undefined;

export function recordUnhandledRejection(reason: unknown): void {
  recorded.push(reason);
}

/** Registers the process listener once per worker; returns whether it did. */
export function installUnhandledRejectionGuard(): boolean {
  if (installed !== undefined) return false;
  installed = recordUnhandledRejection;
  process.on('unhandledRejection', installed);
  return true;
}

export function isGuardInstalled(): boolean {
  return installed !== undefined && process.listeners('unhandledRejection').includes(installed);
}

/** Everything recorded since the last call, cleared. */
export function takeUnhandledRejections(): unknown[] {
  return recorded.splice(0, recorded.length);
}

export function describeRejection(reason: unknown): string {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
}
