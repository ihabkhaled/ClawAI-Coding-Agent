/** The named profiles `--tools-profile` / `toolsProfile` accept. */
export const TOOLS_PROFILE_NAMES: readonly string[] = ['minimal', 'dev', 'full'];

/** Reading the code, git history, and running a program: what a look-around run needs. */
export const MINIMAL_PROFILE_PATTERNS: readonly string[] = [
  'workspace.file.read',
  'workspace.file.list',
  'workspace.file.glob',
  'workspace.file.search',
  'workspace.file.stat',
  'workspace.git.status',
  'workspace.git.diff',
  'workspace.git.log',
  'workspace.git.show',
  'workspace.git.branch',
  'workspace.git.remote',
  'workspace.command',
];

/** `minimal` plus editing, committing, the quality gates, a plan, and long-running programs. */
export const DEV_PROFILE_PATTERNS: readonly string[] = [
  ...MINIMAL_PROFILE_PATTERNS,
  'workspace.file.create',
  'workspace.file.update',
  'workspace.file.delete',
  'workspace.file.rename',
  'workspace.git.add',
  'workspace.git.unstage',
  'workspace.git.restore',
  'workspace.git.commit',
  'workspace.git.fetch',
  'workspace.git.pull',
  'workspace.git.push',
  'workspace.git.switch',
  'code.gates',
  'task.plan',
  'process.watch',
];

/** The most items one profile list may hold. */
export const TOOLS_PROFILE_MAX_ITEMS = 50;

/** What a bare word that is neither a profile nor a pattern is told. */
export const TOOLS_PROFILE_HELP =
  'Use minimal, dev, full, or tool patterns such as workspace.file.read,code.gates (a pattern has a dot or a *).';
