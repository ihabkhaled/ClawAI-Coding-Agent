#!/usr/bin/env node
// A test that reads a developer's temporary directory proves nothing in a fresh
// clone: it either fails to read or, worse, passes against a stale capture.
// This refuses any machine-local absolute path in the sources the gate runs.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanned = ['src', 'tests', 'media', 'scripts'];
const skipped = new Set(['node_modules', '.git', 'dist', 'coverage', 'builds', 'test-results']);
const patterns = [
  { name: 'Windows user or temp path', expression: /[A-Za-z]:[\\/](?:Users|Windows|Temp)[\\/]/ },
  { name: 'macOS home path', expression: /\/Users\/[^/\s"']+\// },
  { name: 'Linux home or temp path', expression: /(?:\/home\/[^/\s"']+\/|\/tmp\/)/ },
];
// Only a path the process actually opens makes a test machine-dependent. Paths
// that are themselves the input under test — a traversal attempt a policy must
// reject — are the point of those tests and must stay.
const readers =
  /\b(?:readFile|readFileSync|readdir|readdirSync|createReadStream|open|openSync|stat|statSync|existsSync|realpath|realpathSync|pathToFileURL|writeFile|writeFileSync)\s*\(|\brequire\s*\(|\bimport\s*\(/;
const LOOKBEHIND = 3;
const extensions = /\.(?:ts|tsx|js|mjs|cjs|json)$/i;

const findings = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(path);
      continue;
    }
    if (!extensions.test(entry.name)) continue;
    const lines = readFileSync(path, 'utf8').split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const matched = patterns.find((pattern) => pattern.expression.test(line));
      if (matched === undefined) continue;
      const window = lines.slice(Math.max(0, index - LOOKBEHIND), index + 1).join('\n');
      if (!readers.test(window)) continue;
      findings.push(`${relative(root, path)}:${index + 1}  ${matched.name} reached by a file read`);
    }
  }
}

for (const directory of scanned) {
  const path = join(root, directory);
  try {
    if (statSync(path).isDirectory()) walk(path);
  } catch {
    /* an optional directory is simply absent */
  }
}

if (findings.length > 0) {
  stderr.write('Machine-local absolute paths are not allowed:\n');
  for (const finding of findings) stderr.write(`  ${finding}\n`);
  exit(1);
}
stdout.write(`No machine-local absolute paths in ${scanned.join(', ')}.\n`);
