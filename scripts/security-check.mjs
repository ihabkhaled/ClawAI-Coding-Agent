#!/usr/bin/env node
// One command for the security pass of every change (skills/secure-every-change/SKILL.md):
//   1. npm audit over ALL dependencies (development tools included), moderate and above;
//   2. gitleaks over the working tree, when gitleaks is installed (CI always runs it);
//   3. open GitHub code-scanning, Dependabot and secret-scanning alerts, when `gh` is signed in.
// Exit 1 when any check finds something; a check that cannot run is reported as SKIPPED, never as passed.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const REPOSITORY = 'ihabkhaled/ClawAI-Coding-Agent';
const results = [];

function run(command, args) {
  // npm is a .cmd shim on Windows and needs a shell; gh and gitleaks must not get one (their
  // arguments carry '&' and '?').
  const shell = command === 'npm' && process.platform === 'win32';
  const result = spawnSync(command, args, { encoding: 'utf8', shell });
  return {
    status: result.status,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    error: result.error,
  };
}

function record(name, state, detail) {
  results.push({ name, state, detail });
}

const audit = run('npm', ['audit', '--audit-level=moderate']);
record(
  'npm audit (all dependencies, moderate+)',
  audit.status === 0 ? 'PASS' : 'FAIL',
  audit.out.trim().split('\n').slice(-3).join(' | '),
);

const gitleaks = run('gitleaks', [
  'dir',
  '.',
  '--config',
  '.gitleaks.toml',
  '--redact',
  '--no-banner',
]);
if (
  gitleaks.error !== undefined ||
  gitleaks.status === null ||
  /not recognized|not found/u.test(gitleaks.out)
) {
  record(
    'gitleaks (working tree)',
    'SKIPPED',
    'gitleaks is not installed; CI runs it on every push',
  );
} else {
  record(
    'gitleaks (working tree)',
    gitleaks.status === 0 ? 'PASS' : 'FAIL',
    gitleaks.out.trim().split('\n').slice(-1).join(''),
  );
}

const alertQueries = [
  ['open code-scanning alerts', `repos/${REPOSITORY}/code-scanning/alerts?state=open&per_page=100`],
  ['open Dependabot alerts', `repos/${REPOSITORY}/dependabot/alerts?state=open&per_page=100`],
  [
    'open secret-scanning alerts',
    `repos/${REPOSITORY}/secret-scanning/alerts?state=open&per_page=100`,
  ],
];
for (const [name, path] of alertQueries) {
  const response = run('gh', ['api', path, '--jq', 'length']);
  if (response.status !== 0) {
    record(name, 'SKIPPED', '`gh` is not signed in or the API is unavailable');
  } else {
    const count = Number.parseInt(response.out.trim(), 10);
    record(name, count === 0 ? 'PASS' : 'FAIL', `${String(count)} open`);
  }
}

for (const { name, state, detail } of results) {
  process.stdout.write(`${state.padEnd(7)} ${name}${detail === '' ? '' : ` - ${detail}`}\n`);
}
process.exit(results.some((result) => result.state === 'FAIL') ? 1 : 0);
