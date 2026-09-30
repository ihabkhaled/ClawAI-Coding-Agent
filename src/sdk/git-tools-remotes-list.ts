import type { GitRemoteEntry } from './git-tools.types';

/** Web URLs lose their whole userinfo (a token is often the username); others lose only a password. */
export function redactRemoteUrl(url: string): string {
  const web = /^(https?:\/\/|ftps?:\/\/)[^/@\s]*@/iu;
  if (web.test(url)) return url.replace(web, '$1***@');
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/:@\s]*):[^/@\s]*@/iu, '$1@');
}

/** Redacts every URL-shaped token in free text. */
export function redactRemoteUrls(text: string): string {
  return text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/giu, (match) => redactRemoteUrl(match));
}

/** `git remote -v` as one entry per remote, credentials removed. */
export function remoteEntries(output: string): GitRemoteEntry[] {
  const entries = new Map<string, { fetchUrl?: string; pushUrl?: string }>();
  for (const line of output.split(/\r?\n/u)) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/u.exec(line.trim());
    if (match === null) continue;
    const [, name = '', url = '', kind = ''] = match;
    const entry = entries.get(name) ?? {};
    const safe = redactRemoteUrl(url);
    if (kind === 'fetch') entry.fetchUrl = safe;
    else entry.pushUrl = safe;
    entries.set(name, entry);
  }
  return [...entries].map(([name, urls]) => ({ name, ...urls }));
}
