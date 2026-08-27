import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

/**
 * What counts as "the source tree" when deciding whether a release is dirty.
 *
 * `builds/` is release OUTPUT that happens to be tracked: release.yml requires
 * the versioned VSIX and its evidence to be committed, and `.gitignore` has no
 * effect on a file Git already tracks. Both workflows run `npm run package`
 * immediately before reading this identity, and packaging rewrites that exact
 * VSIX — so the file is always modified by the time we look.
 *
 * That rewrite is expected, not a problem. release.yml says so in its own words
 * ("VSIX archives contain ZIP timestamps, so two archives with identical
 * extracted content can have different byte hashes") and therefore compares
 * EXTRACTED CONTENT plus deterministic SBOMs rather than archive bytes.
 * Counting the rewrite as a dirty source tree contradicted that design and
 * failed every push to main.
 *
 * Source changes are still caught: anything outside `builds/` still reports.
 */
const SOURCE_PATHSPECS = ['.', ':(exclude)builds'];

async function defaultCommandRunner(command, args, options) {
  const result = await execFileAsync(command, args, { cwd: options.cwd, windowsHide: true });
  return result.stdout.trim();
}

export async function readReleaseIdentity(options) {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const commitSha = (
    await commandRunner('git', ['rev-parse', 'HEAD'], { cwd: options.root })
  ).trim();
  if (!COMMIT_PATTERN.test(commitSha)) {
    throw new Error('Release identity requires a 40-character lowercase Git SHA.');
  }
  const status = await commandRunner('git', ['status', '--porcelain', '--', ...SOURCE_PATHSPECS], {
    cwd: options.root,
  });
  // Kept, not just counted: a gate that refuses to build without naming the
  // file it objects to is the reason this failure was expensive to read.
  const dirtyPaths = Object.freeze(
    status
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
  );
  return Object.freeze({
    repositoryUri: 'git+https://github.com/ihabkhaled/ClawAI-Coding-Agent.git',
    commitSha,
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
  });
}
