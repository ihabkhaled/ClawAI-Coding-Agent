#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import process from 'node:process';

if (process.env.CI === 'true') process.exit(0);

try {
  const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (inside === 'true') {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
    process.stdout.write('git hooks: .githooks enabled\n');
  }
} catch {
  // Installing from a packaged extension is not a Git checkout; no hook is needed there.
}
