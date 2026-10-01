#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const stage = process.argv.includes('--stage');

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.allowFailure ? 'ignore' : 'pipe'],
  }).trim();
}

function gitMaybe(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (match === null) {
    throw new Error(`Expected a stable x.y.z version, received ${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function versionRank(version) {
  return version.major * 1_000_000_000 + version.minor * 1_000 + version.patch;
}

function readBaseVersion() {
  const remote = gitMaybe(['show', 'origin/main:package.json']);
  if (remote !== undefined) return JSON.parse(remote).version;

  const parent = gitMaybe(['show', 'HEAD^1:package.json']);
  if (parent !== undefined) return JSON.parse(parent).version;

  const currentManifest = readFileSync(resolve(root, 'package.json'), 'utf8');
  return JSON.parse(currentManifest).version;
}

function writeJson(path, value) {
  writeFileSync(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

const packagePath = resolve(root, 'package.json');
const lockPath = resolve(root, 'package-lock.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const base = parseVersion(readBaseVersion());
const current = parseVersion(packageJson.version);
const required = `${base.major}.${base.minor + 1}.0`;

if (packageJson.version !== required) {
  const requiredParts = parseVersion(required);
  if (versionRank(current) > versionRank(requiredParts)) {
    const message =
      `Version ${packageJson.version} is ahead of the required delivery version ${required}; ` +
      'choose one coherent minor release.';
    throw new Error(message);
  }

  packageJson.version = required;
  lock.version = required;
  lock.packages[''].version = required;
  writeJson('package.json', packageJson);
  writeJson('package-lock.json', lock);

  const readmePath = resolve(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const versionSentence = `Version ${required} delivers`;
  writeFileSync(readmePath, readme.replace(/^Version \d+\.\d+\.\d+ delivers/mu, versionSentence));

  const changelogPath = resolve(root, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  if (!changelog.includes(`## ${required}\n`)) {
    const marker = '\n## ';
    const index = changelog.indexOf(marker);
    if (index < 0) {
      throw new Error('CHANGELOG.md has no release section insertion point.');
    }
    const entry =
      `\n## ${required}\n\n` +
      '- Automated delivery version for this main-bound change. ' +
      'Replace this line with user-facing release notes when the change needs more detail.\n';
    writeFileSync(changelogPath, changelog.slice(0, index) + entry + changelog.slice(index));
  }

  const previous = `${base.major}.${base.minor}.${base.patch}`;
  process.stdout.write(`version: bumped ${previous} -> ${required}\n`);
} else {
  process.stdout.write(`version: ${required} already prepared\n`);
}

if (stage) {
  git(['add', 'package.json', 'package-lock.json', 'README.md', 'CHANGELOG.md']);
}
