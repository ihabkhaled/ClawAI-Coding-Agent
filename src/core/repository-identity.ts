/**
 * A remote URL as `host/owner/name`, lower-cased host, no scheme, user, port
 * or `.git` — the form an organization writes a trust glob against.
 *
 * Returns undefined for a local-path remote: it names no repository anyone
 * else can recognise, so it cannot satisfy a trust list.
 */
export function normalizeRepositoryUrl(url: string): string | undefined {
  const trimmed = url.trim();
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/u.exec(trimmed);
  let host: string;
  let pathPart: string;
  if (scp !== null && !trimmed.includes('://')) {
    host = scp[1] ?? '';
    pathPart = scp[2] ?? '';
  } else {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return undefined;
    }
    if (parsed.protocol === 'file:' || parsed.hostname.length === 0) return undefined;
    host = parsed.hostname;
    pathPart = parsed.pathname;
  }
  const cleaned = pathPart
    .replace(/^\/+/u, '')
    .replace(/\/+$/u, '')
    .replace(/\.git$/u, '');
  if (host.length === 0 || cleaned.length === 0) return undefined;
  return `${host.toLowerCase()}/${cleaned}`;
}

/** The `origin` remote's URL from a git config file, if it has one. */
export function originUrlFromGitConfig(configText: string): string | undefined {
  let inOrigin = false;
  for (const raw of configText.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\]$/u.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const match = /^url\s*=\s*(.+)$/u.exec(line);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return undefined;
}
