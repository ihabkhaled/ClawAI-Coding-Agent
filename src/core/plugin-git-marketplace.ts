import { createHash } from 'node:crypto';

import { GIT_MARKETPLACE_PREFIX, GIT_REF_PATTERN } from './plugin-git-marketplace.constants';

import type { GitMarketplaceLocation } from './plugin-marketplace.types';

function validRef(ref: string): boolean {
  return GIT_REF_PATTERN.test(ref) && !ref.includes('..') && !ref.endsWith('.lock');
}

/**
 * Reads `git+https://host/repo.git#ref`.
 *
 * Only https, with no user name or password in the URL: a credential in a
 * setting is a credential in every settings sync. The ref is optional and must
 * be a plain branch or tag name, so it cannot smuggle a git option.
 */
export function gitMarketplaceLocation(source: string): GitMarketplaceLocation | undefined {
  const trimmed = source.trim();
  if (!trimmed.startsWith(`${GIT_MARKETPLACE_PREFIX}https://`)) return undefined;
  const withoutPrefix = trimmed.slice(GIT_MARKETPLACE_PREFIX.length);
  const hashAt = withoutPrefix.indexOf('#');
  const url = hashAt === -1 ? withoutPrefix : withoutPrefix.slice(0, hashAt);
  const ref = hashAt === -1 ? undefined : withoutPrefix.slice(hashAt + 1);
  if (!URL.canParse(url)) return undefined;
  const parsed = new URL(url);
  if (parsed.username !== '' || parsed.password !== '' || parsed.search !== '') return undefined;
  if (ref === undefined) return { kind: 'git', url };
  return validRef(ref) ? { kind: 'git', url, ref } : undefined;
}

/** The clone's folder name: stable per URL and ref, and safe as a path segment. */
export function gitCloneFolderName(location: GitMarketplaceLocation): string {
  return createHash('sha256')
    .update(`${location.url}#${location.ref ?? ''}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * The argv for a shallow clone. No shell ever sees it.
 *
 * `--` ends the options before the URL and the folder. Symlinks are checked
 * out as plain files and the local-file and ext transports are refused, so a
 * catalog repository cannot point a clone at the user's own disk.
 */
export function gitCloneArguments(location: GitMarketplaceLocation, target: string): string[] {
  return [
    '-c',
    'core.symlinks=false',
    '-c',
    'protocol.file.allow=never',
    '-c',
    'protocol.ext.allow=never',
    'clone',
    '--depth',
    '1',
    '--no-tags',
    '--single-branch',
    ...(location.ref === undefined ? [] : ['--branch', location.ref]),
    '--',
    location.url,
    target,
  ];
}
