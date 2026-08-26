import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

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
  const status = await commandRunner('git', ['status', '--porcelain'], { cwd: options.root });
  return Object.freeze({
    repositoryUri: 'git+https://github.com/ihabkhaled/ClawAI-Coding-Agent.git',
    commitSha,
    dirty: status.trim().length > 0,
  });
}
