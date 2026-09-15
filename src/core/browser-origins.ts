/**
 * The origins a workspace may add to the ones the browser tool always allows.
 *
 * The built-in pair — the backend and the frontend this extension is signed in
 * to — covers nothing a developer actually wants to look at: their own dev
 * server, their own staging site, the documentation they are working from. Each
 * of those was reachable only by approving an external navigation, one prompt at
 * a time, which is the shape of a permission people click through without
 * reading.
 *
 * Loopback and private addresses are deliberately ALLOWED here, and that is the
 * opposite of the rule the web-fetch tool follows. The difference is who chose
 * the address. `workspace.web` follows URLs a model picked, so a loopback URL
 * there is the classic way to reach a metadata service the user never meant to
 * expose. This list is written by the user, in their own settings, naming a
 * server they are running: refusing `http://localhost:3000` here would refuse
 * the main reason the setting exists.
 *
 * What is still refused is anything that is not a real origin a browser can be
 * pointed at: a non-http scheme, and any URL carrying credentials — a password
 * in a settings file is a password in a backup, a screen share and a bug report.
 */
export function parseAllowedOrigins(values: readonly string[]): string[] {
  const origins = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length === 0) continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.username.length > 0 || url.password.length > 0) continue;
    origins.add(url.origin);
  }
  return [...origins];
}

/**
 * The full allow list: what the extension always permits, plus what the
 * workspace added, with duplicates collapsed.
 *
 * The built-ins come first and cannot be removed by configuration. A setting
 * that could subtract the backend origin would let a workspace file break sign
 * in, and a workspace file may only ever add.
 */
export function browserAllowedOrigins(
  builtIn: readonly string[],
  configured: readonly string[],
): string[] {
  return [...new Set([...builtIn, ...parseAllowedOrigins(configured)])];
}
