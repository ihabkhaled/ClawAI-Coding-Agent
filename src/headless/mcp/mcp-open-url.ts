import { execFile } from 'node:child_process';

function openerFor(url: string, platform: NodeJS.Platform): [string, string[]] {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', url]];
  if (platform === 'darwin') return ['open', [url]];
  return ['xdg-open', [url]];
}

/**
 * Hands a URL to the platform's opener. No shell is involved, so the URL is one
 * argument and never parsed as a command line. Failure is silent: the URL was
 * already printed, and a person can open it by hand.
 */
export function openUrlWithPlatform(
  url: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const [command, args] = openerFor(url, platform);
  try {
    execFile(command, args, { windowsHide: true }, () => undefined).unref();
  } catch {
    // Nothing to do: see above.
  }
}
