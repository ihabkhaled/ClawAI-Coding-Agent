import type {
  PluginDirectoryEntry,
  PluginFileSystemPort,
} from '../../src/services/plugin-store.types';

/** An in-memory file system with posix paths, for plugin store tests. */
export class MemoryPluginFileSystem implements PluginFileSystemPort {
  readonly files = new Map<string, Uint8Array>();

  put(path: string, content: string): void {
    this.files.set(path, new TextEncoder().encode(content));
  }

  text(path: string): string | undefined {
    const bytes = this.files.get(path);
    return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
  }

  async list(path: string): Promise<readonly PluginDirectoryEntry[]> {
    const prefix = `${path}/`;
    const entries = new Map<string, PluginDirectoryEntry['kind']>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const [name, ...rest] = key.slice(prefix.length).split('/');
      if (name !== undefined) entries.set(name, rest.length > 0 ? 'directory' : 'file');
    }
    return [...entries].map(([name, kind]) => ({ name, kind }));
  }

  async readFile(path: string): Promise<Uint8Array | undefined> {
    return this.files.get(path);
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async delete(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }

  join(base: string, ...segments: string[]): string {
    return [base, ...segments].join('/');
  }
}

export function manifestJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    name: 'review-kit',
    publisher: 'acme',
    version: '1.0.0',
    description: 'Review helpers',
    contributes: {
      skills: ['skills'],
      commands: ['commands'],
      outputStyles: ['styles'],
      hooks: [
        { event: 'before-tool', command: '${pluginRoot}/guard.sh', arguments: ['${pluginRoot}'] },
      ],
      mcpServers: { docs: { command: 'docs-server' } },
    },
    ...overrides,
  });
}
