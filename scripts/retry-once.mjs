// One bounded retry for a lane that is known to flake on the hosted runner.
//
// The VS Code extension-host lane sometimes dies with "CodeWindow: detected
// unresponsive" before a single test runs: the Electron window never comes up on a
// busy runner. Re-running the identical lane passes. A real regression fails twice,
// so retrying exactly once hides the flake and nothing else. Never more than one
// retry: an unbounded loop would turn a genuine hang into a six-hour job.
export async function retryOnce(run, { label = 'lane', log = () => {} } = {}) {
  try {
    return await run(1);
  } catch (first) {
    log(
      `${label} failed once (${first instanceof Error ? first.message : String(first)}); retrying once`,
    );
    return run(2);
  }
}
