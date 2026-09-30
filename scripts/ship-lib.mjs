// Pure helpers behind `npm run ship` / `npm run preflight`. No I/O here, so every
// rule that has ever turned a push red on GitHub can be tested without GitHub.

export const CI_NODE_IMAGE = 'node:22-bookworm-slim';

// The Linux gate, in the order CI runs it. It runs as the unprivileged `node`
// user because the GitHub runner is not root: a test that writes to `/global`
// passes as root and fails with EACCES in CI.
export const CONTAINER_SCRIPT = [
  'set -euo pipefail',
  'mkdir -p /tmp/w && tar -x -C /tmp/w && cd /tmp/w',
  // CI checks out a git repository; scripts such as l10n:verify diff against it.
  'git init -q && git add -A',
  'git -c user.email=ci@local -c user.name=ci commit -qm preflight',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'npm run l10n:build',
  "git diff --exit-code -- package.nls.json 'package.nls.*.json' l10n",
  'npm run check',
  'npm audit --omit=dev --audit-level=high',
].join('\n');

export function dockerRunArgs(image = CI_NODE_IMAGE) {
  return [
    'run',
    '--rm',
    '-i',
    '--user',
    'node',
    '-e',
    'HOME=/tmp/home',
    image,
    'bash',
    '-c',
    CONTAINER_SCRIPT,
  ];
}

export function releaseAssetPaths(version) {
  const base = `builds/clawai-coding-agent-${version}`;
  const files = ['.vsix', '.cdx.json', '.spdx.json', '.provenance.json'];
  return files.flatMap((suffix) => [`${base}${suffix}`, `${base}${suffix}.sha256`]);
}

/**
 * What the Release workflow's first two gates would say, before pushing.
 * `remoteTags` are tag names on origin; `trackedFiles` are files in git HEAD
 * (builds/ is gitignored, so an asset that exists on disk is not enough).
 */
export function releaseGateProblems({ version, remoteTags, trackedFiles }) {
  const problems = [];
  if (remoteTags.includes(`v${version}`)) {
    problems.push(
      `v${version} already exists on origin: bump the version before every push to main.`,
    );
  }
  const tracked = new Set(trackedFiles);
  for (const asset of releaseAssetPaths(version)) {
    if (!tracked.has(asset)) {
      problems.push(
        `${asset} is not committed: package, run supply-chain, then git add -f builds/...`,
      );
    }
  }
  return problems;
}

// Shapes GitHub push protection blocks (GH013). Lengths follow the real formats,
// so an obvious placeholder passes and a plausible token does not.
export const SECRET_SHAPES = [
  ['GitLab token', /glpat-[A-Za-z0-9_-]{20,}/u],
  ['Slack app token', /xapp-\d-[A-Z0-9]+-\d+-[a-f0-9]{16,}/u],
  ['Slack token', /xox[baprs]-[A-Za-z0-9-]{10,}/u],
  ['SendGrid key', /SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/u],
  ['Stripe webhook secret', /whsec_[A-Za-z0-9]{20,}/u],
  ['Stripe live key', /sk_live_[A-Za-z0-9]{20,}/u],
  ['GitHub token', /gh[pousr]_[A-Za-z0-9]{36}/u],
  ['GitHub fine-grained token', /github_pat_[A-Za-z0-9_]{22,}/u],
  ['npm token', /npm_[A-Za-z0-9]{36}/u],
  ['AWS access key', /AKIA[0-9A-Z]{16}/u],
  ['Google API key', /AIza[0-9A-Za-z_-]{35}/u],
];

/** Secret-shaped literals among the ADDED lines of a unified diff. */
export function secretShapedAdditions(diffText) {
  const found = [];
  let file = '';
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.slice(6);
    } else if (line.startsWith('+')) {
      for (const [label, pattern] of SECRET_SHAPES) {
        if (pattern.test(line)) found.push({ file, label });
      }
    }
  }
  return found;
}

/**
 * One verdict for the runs GitHub reports on a commit. Any failed run is red
 * even while others are still going: waiting on a doomed commit wastes time.
 */
export function gateVerdict(runs, expectedWorkflows = ['CI', 'Release']) {
  const failed = runs.filter((run) => run.status === 'completed' && run.conclusion !== 'success');
  if (failed.length > 0) return { state: 'red', failed: failed.map((run) => run.name) };
  const seen = new Map(runs.map((run) => [run.name, run]));
  const done = expectedWorkflows.every((name) => seen.get(name)?.status === 'completed');
  return done ? { state: 'green', failed: [] } : { state: 'pending', failed: [] };
}

/** The command that pushes without the Windows credential manager, which hangs on a hidden prompt. */
export const PUSH_ARGS = [
  '-c',
  'credential.helper=',
  '-c',
  'credential.helper=!gh auth git-credential',
  'push',
  'origin',
  'HEAD:main',
];
