// Turns the in-repo living wiki (docs/wiki/) into GitHub wiki pages.
//
// The GitHub wiki is flat: a page is addressed by its file name, so
// docs/wiki/libraries/zod.md becomes the page "Libraries-zod". Relative links
// are rewritten: to another wiki page by its page name, to any other repository
// file by its blob URL on the default branch. docs/adr/0009 records why the
// repository is the source and the GitHub wiki only a mirror.
import path from 'node:path';

const LINK = /\]\(([^)\s]+)\)/gu;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/iu;

function titleCase(word) {
  return word
    .split('-')
    .map((part) => (part === '' ? part : part[0].toUpperCase() + part.slice(1)))
    .join('-');
}

/** The GitHub wiki page name for a file path relative to docs/wiki/. */
export function pageNameFor(relative) {
  const parts = relative.replaceAll('\\', '/').replace(/\.md$/u, '').split('/');
  if (parts.length === 1) {
    return parts[0] === 'index' ? 'Home' : titleCase(parts[0]);
  }
  const [category, ...rest] = parts;
  const tail = rest.join('-');
  return tail === 'README' ? titleCase(category) : `${titleCase(category)}-${tail}`;
}

/** Rewrites one link target found in `fromRelative` (a docs/wiki/-relative path). */
export function rewriteTarget(target, fromRelative, wikiFiles, blobBase) {
  if (EXTERNAL.test(target)) return target;
  const [rawPath, anchor] = target.split('#', 2);
  const suffix = anchor === undefined ? '' : `#${anchor}`;
  const fromDir = path.posix.dirname(fromRelative.replaceAll('\\', '/'));
  const joined = path.posix.normalize(path.posix.join('docs/wiki', fromDir, rawPath));
  if (joined.startsWith('docs/wiki/') || joined === 'docs/wiki') {
    const inside = joined === 'docs/wiki' ? '' : joined.slice('docs/wiki/'.length);
    const candidates =
      rawPath.endsWith('/') || inside === '' || !inside.endsWith('.md')
        ? [`${inside.replace(/\/$/u, '')}/README.md`, `${inside}.md`, inside, 'index.md']
        : [inside];
    const hit = candidates.find((candidate) => wikiFiles.has(candidate.replace(/^\//u, '')));
    if (hit !== undefined) return `${pageNameFor(hit.replace(/^\//u, ''))}${suffix}`;
  }
  if (joined.startsWith('..')) return target;
  return `${blobBase}/${joined}${suffix}`;
}

/** Every relative link in a page, rewritten for the GitHub wiki. */
export function rewriteLinks(markdown, fromRelative, wikiFiles, blobBase) {
  return markdown.replace(LINK, (_whole, target) => {
    return `](${rewriteTarget(target, fromRelative, wikiFiles, blobBase)})`;
  });
}

/**
 * All pages, the sidebar and a header naming each page's source file.
 * `files` maps a docs/wiki/-relative path to its Markdown text.
 */
export function renderWiki(files, blobBase) {
  const wikiFiles = new Set(files.keys());
  const pages = new Map();
  for (const [relative, markdown] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const name = pageNameFor(relative);
    if (pages.has(`${name}.md`)) {
      throw new Error(`Two wiki files map to the page "${name}": rename one (${relative}).`);
    }
    const source = `${blobBase}/docs/wiki/${relative.replaceAll('\\', '/')}`;
    const header = `> Mirrored from [\`docs/wiki/${relative}\`](${source}). Edit it there; this page is regenerated on every push to main.\n\n`;
    pages.set(`${name}.md`, header + rewriteLinks(markdown, relative, wikiFiles, blobBase));
  }
  const categories = [...wikiFiles]
    .filter((file) => file.endsWith('/README.md') || (!file.includes('/') && file !== 'index.md'))
    .map((file) => pageNameFor(file))
    .sort((a, b) => a.localeCompare(b));
  const sidebar = ['**[Home](Home)**', '', ...categories.map((name) => `- [${name}](${name})`)];
  pages.set('_Sidebar.md', `${sidebar.join('\n')}\n`);
  return pages;
}
