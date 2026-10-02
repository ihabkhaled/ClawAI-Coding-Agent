import {
  REMOTE_ALLOWED_PROTOCOLS,
  REMOTE_FORBIDDEN_PATTERN,
  REMOTE_SCP_HOST_PATTERN,
  REMOTE_SCP_PATH_PATTERN,
  REMOTE_URL_SCHEME_PATTERN,
  REPOSITORY_BRANCH_MAX,
  REPOSITORY_BRANCH_PATTERN,
  REPOSITORY_NAME_MAX,
  REPOSITORY_NAME_PATTERN,
  REPOSITORY_REMOTE_MAX,
} from './repository-ref.constants';

import type { RepositoryFacts, RepositoryRef } from './repository-ref.types';

interface RemoteParts {
  readonly host: string;
  readonly port: string;
  readonly path: string;
}

function fromUrl(text: string): RemoteParts | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (!REMOTE_ALLOWED_PROTOCOLS.includes(url.protocol) || url.hostname === '') return undefined;
  const web = url.protocol === 'http:' || url.protocol === 'https:';
  return {
    host: url.hostname.toLowerCase(),
    port: web && url.port !== '' ? `:${url.port}` : '',
    path: url.pathname,
  };
}

function fromScp(text: string): RemoteParts | undefined {
  const colon = text.indexOf(':');
  const path = text.slice(colon + 1);
  if (colon < 1 || path.startsWith('//') || !REMOTE_SCP_PATH_PATTERN.test(path)) return undefined;
  const left = text.slice(0, colon);
  const at = left.lastIndexOf('@');
  const host = at < 0 ? left : left.slice(at + 1);
  if (!REMOTE_SCP_HOST_PATTERN.test(host)) return undefined;
  if (at < 0 && !host.includes('.')) return undefined;
  return { host: host.toLowerCase(), port: '', path };
}

function cleanPath(rawPath: string): string | undefined {
  const segments = rawPath.split('/').filter((segment) => segment !== '');
  const last = segments.at(-1);
  if (last === undefined) return undefined;
  const bare = last.endsWith('.git') ? last.slice(0, -'.git'.length) : last;
  return bare === '' ? undefined : [...segments.slice(0, -1), bare].join('/');
}

/**
 * One credential-free identifier for a git remote, `https://host[:port]/path`.
 * The result is built from the host, port and path alone, so a token typed
 * into a remote (`https://user:token@host/x.git`) never leaves the machine.
 * A local path, `file:`, or anything that is not a remote gives undefined.
 */
export function repositoryRemoteIdentifier(raw: string | undefined): string | undefined {
  const text = raw?.trim() ?? '';
  if (text === '' || REMOTE_FORBIDDEN_PATTERN.test(text)) return undefined;
  const parts = REMOTE_URL_SCHEME_PATTERN.test(text) ? fromUrl(text) : fromScp(text);
  if (parts === undefined) return undefined;
  const path = cleanPath(parts.path);
  if (path === undefined) return undefined;
  const identifier = `https://${parts.host}${parts.port}/${path}`;
  return identifier.length <= REPOSITORY_REMOTE_MAX ? identifier : undefined;
}

/**
 * The reference sent with a new thread, or undefined for a workspace with no
 * git remote (nothing to match on; a bare folder name would only mislead).
 * A branch that is not a plain ref name is left out rather than sent.
 */
export function repositoryRefOf(facts: RepositoryFacts): RepositoryRef | undefined {
  const remoteUrl = repositoryRemoteIdentifier(facts.remoteUrl);
  if (remoteUrl === undefined) return undefined;
  const name = facts.folderName.trim();
  if (name === '' || name.length > REPOSITORY_NAME_MAX || !REPOSITORY_NAME_PATTERN.test(name)) {
    return undefined;
  }
  const branch = facts.branch?.trim();
  const branchOk =
    branch !== undefined &&
    branch !== '' &&
    branch.length <= REPOSITORY_BRANCH_MAX &&
    REPOSITORY_BRANCH_PATTERN.test(branch);
  return { name, remoteUrl, ...(branchOk ? { branch } : {}) };
}
