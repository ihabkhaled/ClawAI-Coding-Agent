#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitMaybe(args) {
  try {
    return git(args);
  } catch {
    return undefined;
  }
}

function parse(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value);
  if (match === null) throw new Error(`Invalid stable SemVer: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function baseRef() {
  const explicitIndex = process.argv.indexOf('--base');
  if (explicitIndex >= 0) return process.argv[explicitIndex + 1];
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  if (process.env.GITHUB_EVENT_NAME === 'push') return 'HEAD^1';
  return 'origin/main';
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const ref = baseRef();
const baseRaw = gitMaybe(['show', `${ref}:package.json`]);
if (baseRaw === undefined) throw new Error(`Cannot read package.json from ${ref}`);
const baseVersion = JSON.parse(baseRaw).version;
const base = parse(baseVersion);
const current = parse(manifest.version);
const expected = `${base.major}.${base.minor + 1}.0`;

if (manifest.version !== expected) {
  throw new Error(
    `Every main-bound change must advance one delivery minor: ${baseVersion} -> ${expected}; found ${manifest.version}.`,
  );
}
if (current.patch !== 0) throw new Error('Delivery releases must reset patch to 0.');
if (lock.version !== manifest.version || lock.packages?.['']?.version !== manifest.version) {
  throw new Error('package-lock.json version fields must match package.json.');
}
const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (!changelog.includes(`## ${manifest.version}\n`)) {
  throw new Error(`CHANGELOG.md needs a ## ${manifest.version} section.`);
}
const readme = readFileSync('README.md', 'utf8');
if (!readme.includes(`Version ${manifest.version} delivers`)) {
  throw new Error(`README.md must name Version ${manifest.version}.`);
}
const remoteTags = gitMaybe(['ls-remote', '--tags', 'origin', `refs/tags/v${manifest.version}`]);
if (remoteTags !== undefined && remoteTags.length > 0) {
  throw new Error(`v${manifest.version} already exists; bump again before main.`);
}
process.stdout.write(`version: verified ${baseVersion} -> ${manifest.version}\n`);
