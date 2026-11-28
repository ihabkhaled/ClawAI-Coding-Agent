// Renders docs/wiki/ into a folder of GitHub wiki pages (used by .github/workflows/publish-wiki.yml).
// Usage: node scripts/render-wiki.mjs --out <dir> [--repo <owner/name>]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { renderWiki } from './wiki-render-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiRoot = path.join(root, 'docs', 'wiki');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function markdownFiles(directory, prefix = '') {
  const found = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [key, value] of markdownFiles(path.join(directory, entry.name), relative)) {
        found.set(key, value);
      }
    } else if (entry.name.endsWith('.md')) {
      found.set(relative, readFileSync(path.join(directory, entry.name), 'utf8'));
    }
  }
  return found;
}

const out = argument('--out');
if (out === undefined) {
  process.stderr.write('render-wiki: --out <dir> is required\n');
  process.exit(2);
}
const repository = argument('--repo', 'ihabkhaled/ClawAI-Coding-Agent');
const pages = renderWiki(markdownFiles(wikiRoot), `https://github.com/${repository}/blob/main`);
mkdirSync(out, { recursive: true });
for (const [name, text] of pages) writeFileSync(path.join(out, name), text);
process.stdout.write(`render-wiki: wrote ${String(pages.size)} pages to ${out}\n`);
