import { describe, expect, it } from 'vitest';

import { pageNameFor, renderWiki, rewriteTarget } from '../../scripts/wiki-render-lib.mjs';

const BLOB = 'https://github.com/owner/repo/blob/main';
const FILES = new Set(['index.md', 'glossary.md', 'business/README.md', 'libraries/zod.md']);

describe('GitHub wiki page names for docs/wiki files', () => {
  it.each([
    ['index.md', 'Home'],
    ['glossary.md', 'Glossary'],
    ['business/README.md', 'Business'],
    ['libraries/zod.md', 'Libraries-zod'],
    ['features/run-lifecycle.md', 'Features-run-lifecycle'],
  ])('names %s as %s', (file, page) => {
    expect(pageNameFor(file)).toBe(page);
  });
});

describe('link rewriting', () => {
  it('points a link to another wiki page at its page name, keeping the anchor', () => {
    expect(rewriteTarget('../libraries/zod.md#why', 'business/README.md', FILES, BLOB)).toBe(
      'Libraries-zod#why',
    );
  });

  it('resolves a folder link to that folder README page', () => {
    expect(rewriteTarget('business/', 'index.md', FILES, BLOB)).toBe('Business');
  });

  it('points a repository file outside the wiki at its blob URL', () => {
    expect(rewriteTarget('../ARCHITECTURE.md', 'index.md', FILES, BLOB)).toBe(
      `${BLOB}/docs/ARCHITECTURE.md`,
    );
    expect(rewriteTarget('../../README.md#quick-start', 'index.md', FILES, BLOB)).toBe(
      `${BLOB}/README.md#quick-start`,
    );
  });

  it('leaves absolute URLs, anchors and paths above the repository untouched', () => {
    expect(rewriteTarget('https://example.com/a.md', 'index.md', FILES, BLOB)).toBe(
      'https://example.com/a.md',
    );
    expect(rewriteTarget('#gaps', 'index.md', FILES, BLOB)).toBe('#gaps');
    expect(rewriteTarget('../../../outside.md', 'index.md', FILES, BLOB)).toBe(
      '../../../outside.md',
    );
  });
});

describe('rendering the whole wiki', () => {
  const files = new Map([
    ['index.md', '# Wiki\n\nSee [business](business/) and [zod](libraries/zod.md).\n'],
    ['business/README.md', '# Business\n\nBack to the [index](../index.md).\n'],
    ['libraries/zod.md', '# zod\n'],
  ]);

  it('writes every page with a source header, plus a sidebar', () => {
    const pages = renderWiki(files, BLOB);

    expect([...pages.keys()].sort()).toEqual([
      'Business.md',
      'Home.md',
      'Libraries-zod.md',
      '_Sidebar.md',
    ]);
    expect(pages.get('Home.md')).toContain('[business](Business)');
    expect(pages.get('Home.md')).toContain('[zod](Libraries-zod)');
    expect(pages.get('Home.md')).toContain(`(${BLOB}/docs/wiki/index.md)`);
    expect(pages.get('Business.md')).toContain('[index](Home)');
    expect(pages.get('_Sidebar.md')).toContain('- [Business](Business)');
  });

  it('refuses two files that would overwrite the same page', () => {
    const clash = new Map([
      ['business/README.md', '# a'],
      ['business.md', '# b'],
    ]);

    expect(() => renderWiki(clash, BLOB)).toThrow(/Two wiki files map to the page "Business"/u);
  });
});
