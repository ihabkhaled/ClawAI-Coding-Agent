import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import {
  MCP_LOGIN_CONFIG_DIR_NAME,
  MCP_LOGIN_TOKEN_FILE_NAME,
  MCP_TOKEN_DIR_MODE,
  MCP_TOKEN_FILE_MAX_BYTES,
  MCP_TOKEN_FILE_MODE,
  MCP_TOKEN_FILE_VERSION,
} from './mcp-login.constants';

import type { McpTokenFileFs } from './mcp-login.types';
import type { McpSecretStore } from '../../services/mcp-oauth-service.types';

const fileSchema = z.object({
  version: z.literal(MCP_TOKEN_FILE_VERSION),
  entries: z.record(z.string(), z.string()),
});

type Entries = Readonly<Record<string, string>>;
type Environment = Readonly<Record<string, string | undefined>>;

export const NODE_TOKEN_FILE_FS: McpTokenFileFs = {
  readFile: async (file) => {
    try {
      if ((await stat(file)).size > MCP_TOKEN_FILE_MAX_BYTES) return undefined;
      return await readFile(file, 'utf8');
    } catch {
      return undefined;
    }
  },
  writeFile: (file, text, mode) => writeFile(file, text, { encoding: 'utf8', mode, flag: 'w' }),
  rename,
  mkdir: async (directory, mode) => {
    await mkdir(directory, { recursive: true, mode });
  },
};

function configRoot(environment: Environment, platform: NodeJS.Platform, home: string): string {
  if (platform === 'win32') return environment.APPDATA ?? join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  return environment.XDG_CONFIG_HOME ?? join(home, '.config');
}

/**
 * The per-user token file: `%APPDATA%\clawai` on Windows,
 * `~/Library/Application Support/clawai` on macOS, `$XDG_CONFIG_HOME/clawai`
 * (else `~/.config/clawai`) elsewhere. `CLAW_CONFIG_DIR` replaces the directory.
 */
export function defaultTokenFile(
  environment: Environment,
  platform: NodeJS.Platform,
  home: string,
): string {
  const override = environment.CLAW_CONFIG_DIR;
  const directory =
    override !== undefined && override.length > 0
      ? override
      : join(configRoot(environment, platform, home), MCP_LOGIN_CONFIG_DIR_NAME);
  return join(directory, MCP_LOGIN_TOKEN_FILE_NAME);
}

async function readEntries(file: string, fs: McpTokenFileFs): Promise<Entries> {
  const text = await fs.readFile(file);
  if (text === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return fileSchema.parse(parsed).entries;
  } catch {
    // A corrupt file reads as "no tokens": the person signs in again.
    return {};
  }
}

/** Written beside the target and renamed over it, so a crash never leaves half a token file. */
async function writeEntries(file: string, entries: Entries, fs: McpTokenFileFs): Promise<void> {
  await fs.mkdir(dirname(file), MCP_TOKEN_DIR_MODE);
  const temporary = `${file}.${String(process.pid)}.tmp`;
  const body = JSON.stringify({ version: MCP_TOKEN_FILE_VERSION, entries });
  await fs.writeFile(temporary, body, MCP_TOKEN_FILE_MODE);
  await fs.rename(temporary, file);
}

/** The token file as a secret store: reads and writes go to disk, one at a time. */
export function fileTokenStore(
  file: string,
  fs: McpTokenFileFs = NODE_TOKEN_FILE_FS,
): McpSecretStore {
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    get: (key) => exclusive(async () => (await readEntries(file, fs))[key]),
    store: (key, value) =>
      exclusive(async () => {
        await writeEntries(file, { ...(await readEntries(file, fs)), [key]: value }, fs);
      }),
    delete: (key) =>
      exclusive(async () => {
        const { [key]: removed, ...rest } = await readEntries(file, fs);
        if (removed !== undefined) await writeEntries(file, rest, fs);
      }),
  };
}

/**
 * Tokens held in memory only. When a file is given it is read once, lazily, and
 * never written: a refreshed token lives for this process, so a token file that
 * arrives as a mounted CI secret stays exactly as it was mounted.
 */
export function memoryTokenStore(
  seedFile?: string,
  fs: McpTokenFileFs = NODE_TOKEN_FILE_FS,
): McpSecretStore {
  let entries: Promise<Map<string, string>> | undefined;
  const load = (): Promise<Map<string, string>> => {
    entries ??= (async () =>
      new Map(Object.entries(seedFile === undefined ? {} : await readEntries(seedFile, fs))))();
    return entries;
  };
  return {
    get: async (key) => (await load()).get(key),
    store: async (key, value) => {
      (await load()).set(key, value);
    },
    delete: async (key) => {
      (await load()).delete(key);
    },
  };
}
