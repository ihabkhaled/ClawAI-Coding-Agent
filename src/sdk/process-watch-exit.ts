const live = new Set<() => void>();
let installed = false;

const KILLING_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

function killAll(): void {
  for (const kill of [...live]) kill();
}

function onSignal(signal: NodeJS.Signals): void {
  killAll();
  // SIGINT is the headless runner's own cancel; it ends the run and disposes.
  // For the others a listener of ours stops the default exit, so give it back.
  if (signal === 'SIGINT') return;
  process.removeListener(signal, onSignal);
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('exit', killAll);
  for (const signal of KILLING_SIGNALS) process.on(signal, onSignal);
}

function uninstall(): void {
  if (!installed || live.size > 0) return;
  installed = false;
  process.removeListener('exit', killAll);
  for (const signal of KILLING_SIGNALS) process.removeListener(signal, onSignal);
}

/**
 * Makes `kill` run when the host process exits or is interrupted, so a
 * Ctrl+C, a second Ctrl+C that calls `exit`, or a SIGTERM never leaves a dev
 * server holding its port. Returns the function that withdraws it. The process
 * listeners exist only while something is registered.
 */
export function killOnProcessExit(kill: () => void): () => void {
  live.add(kill);
  install();
  return () => {
    live.delete(kill);
    uninstall();
  };
}
