export function pageNameFor(relative: string): string;
export function rewriteTarget(
  target: string,
  fromRelative: string,
  wikiFiles: ReadonlySet<string>,
  blobBase: string,
): string;
export function rewriteLinks(
  markdown: string,
  fromRelative: string,
  wikiFiles: ReadonlySet<string>,
  blobBase: string,
): string;
export function renderWiki(
  files: ReadonlyMap<string, string>,
  blobBase: string,
): Map<string, string>;
