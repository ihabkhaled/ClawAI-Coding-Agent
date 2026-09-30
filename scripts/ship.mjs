#!/usr/bin/env node
// The only sanctioned way to put code on main:
//   npm run preflight   run every gate GitHub will run, on Linux, without pushing
//   npm run ship        preflight, push, then watch CI and Release until green
// It exists because ten pushes in a row went red on GitHub for reasons a local
// Linux run of the same commands would have shown. See docs/CI_FAILURES.md.
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import {
  PUSH_ARGS,
  dockerRunArgs,
  gateVerdict,
  releaseGateProblems,
  secretShapedAdditions,
} from './ship-lib.mjs';

const preflightOnly = process.argv.includes('--preflight-only');
const WATCH_MINUTES = 40;
const POLL_MS = 30_000;

const capture = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    out: `${result.stdout ?? ''}`.trim(),
    err: `${result.stderr ?? ''}`.trim(),
  };
};

const fail = (message) => {
  process.stderr.write(`\nship: ${message}\n`);
  process.exit(1);
};

const step = (message) => process.stdout.write(`\n== ${message}\n`);

function requireCleanCurrentTree() {
  step('The tree must be committed: CI tests commits, not your working directory');
  const status = capture('git', ['status', '--porcelain']);
  // A CRLF-only phantom shows as modified with no content change.
  const dirty = status.out.split(String.fromCharCode(10)).filter(Boolean);
  const real = dirty.filter(
    (line) =>
      line.startsWith('??') ||
      !capture('git', ['diff', '--ignore-cr-at-eol', '--quiet', 'HEAD', '--', line.slice(3)]).ok,
  );
  if (real.length > 0) fail(`uncommitted changes: ${real.join(', ')}`);
  capture('git', ['fetch', '-q', 'origin']);
  const behind = capture('git', ['rev-list', '--count', 'HEAD..origin/main']);
  if (behind.out !== '0')
    fail(
      `origin/main has ${behind.out} commit(s) you do not have: git pull --rebase, then re-run.`,
    );
}

function checkReleaseGates() {
  step('Release intent: publish a new version only when its tag is free');
  const version = JSON.parse(capture('git', ['show', 'HEAD:package.json']).out).version;
  const tags = capture('git', ['ls-remote', '--tags', 'origin']).out.split('\n');
  const remoteTags = tags.map((line) => line.split('refs/tags/')[1]).filter(Boolean);
  if (remoteTags.includes(`v${version}`)) {
    process.stdout.write(
      `version ${version}: already published; normal main update, release assets not required\n`,
    );
    return;
  }
  const trackedFiles = capture('git', ['ls-files', 'builds']).out.split('\n');
  const problems = releaseGateProblems({ version, remoteTags, trackedFiles });
  if (problems.length > 0) fail(problems.join('\n'));
  process.stdout.write(`version ${version}: new release requested, assets committed\n`);
}

function checkOutgoingSecrets() {
  step('Push protection: secret-shaped literals in the commits being pushed');
  const diff = capture('git', [
    'diff',
    'origin/main..HEAD',
    '--unified=0',
    '--',
    '.',
    ':!builds',
  ]).out;
  const found = secretShapedAdditions(diff);
  if (found.length > 0) {
    const lines = found.map((hit) => `${hit.file}: ${hit.label}`).join('\n');
    fail(
      `GitHub would block this push (GH013):\n${lines}\nBuild test tokens from joined parts, e.g. ['glpat', 'abc...'].join('-').`,
    );
  }
}

function runLinuxGate() {
  step('Linux gate: install, localization, check, audit (node 22, non-root, like GitHub)');
  if (!capture('docker', ['info']).ok) fail('Docker is required: the Linux gate is not optional.');
  return new Promise((resolve) => {
    const archive = spawn('git', ['archive', 'HEAD'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const docker = spawn('docker', dockerRunArgs(), { stdio: ['pipe', 'inherit', 'inherit'] });
    archive.stdout.pipe(docker.stdin);
    docker.on('close', (code) => resolve(code ?? 1));
  });
}

function push() {
  step('Push (gh credential helper: the Windows credential manager hangs)');
  const result = spawnSync('git', PUSH_ARGS, { stdio: 'inherit' });
  if (result.status !== 0)
    fail('push failed (see the message above; a rejected ref means pull --rebase and re-run).');
}

async function watchGates(sha) {
  step(`Watching GitHub gates for ${sha.slice(0, 7)} (up to ${String(WATCH_MINUTES)} min)`);
  const deadline = Date.now() + WATCH_MINUTES * 60_000;
  while (Date.now() < deadline) {
    const listed = capture('gh', [
      'run',
      'list',
      '-L',
      '20',
      '--json',
      'name,status,conclusion,headSha,databaseId',
    ]);
    const runs = listed.ok ? JSON.parse(listed.out).filter((run) => run.headSha === sha) : [];
    const verdict = gateVerdict(runs);
    if (verdict.state === 'green') {
      process.stdout.write('GitHub gates are green.\n');
      return;
    }
    if (verdict.state === 'superseded') {
      fail(
        `${verdict.failed.join(', ')} was cancelled by a newer push to main. Watch the newest commit instead: gh run list.`,
      );
    }
    if (verdict.state === 'red') {
      for (const run of runs.filter((candidate) => verdict.failed.includes(candidate.name))) {
        const log = capture('gh', ['run', 'view', String(run.databaseId), '--log-failed']);
        process.stderr.write(
          `\n--- ${run.name} failed ---\n${log.out.split('\n').slice(-40).join('\n')}\n`,
        );
      }
      fail(
        `red: ${verdict.failed.join(', ')}. Fix it before any other work, then run ship again with a new commit.`,
      );
    }
    await delay(POLL_MS);
  }
  fail('gates did not finish in time: check GitHub before doing anything else.');
}

requireCleanCurrentTree();
checkReleaseGates();
checkOutgoingSecrets();
const code = await runLinuxGate();
if (code !== 0)
  fail(`the Linux gate failed (exit ${String(code)}): GitHub would fail the same way.`);
process.stdout.write('\nPreflight passed.\n');
if (!preflightOnly) {
  push();
  await watchGates(capture('git', ['rev-parse', 'HEAD']).out);
}
