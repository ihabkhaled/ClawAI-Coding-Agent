import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { AGENT_CONTEXT_SKIPPED_DIRECTORIES } from './agent-context.constants';

import type { AgentContextFileSystem } from './agent-context.types';

/** `file` resolved under `root`, refused when it is, or links, outside it. */
async function inside(root: string, relativePath: string): Promise<string> {
  const absolute = path.resolve(root, relativePath);
  const base = await realpath(root);
  const real = await realpath(absolute);
  const relative = path.relative(base, real);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new RangeError(`${relativePath} is outside the workspace.`);
  }
  return real;
}

async function walk(
  root: string,
  directory: string,
  limit: number,
  found: string[],
): Promise<void> {
  const entries = (await readdir(path.join(root, directory), { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  for (const entry of entries) {
    if (found.length >= limit) return;
    const relative = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!AGENT_CONTEXT_SKIPPED_DIRECTORIES.includes(entry.name)) {
        await walk(root, relative, limit, found);
      }
    } else if (entry.isFile()) {
      found.push(relative);
    }
  }
}

/** The real file system, with the same containment rule the editor applies to every read. */
export const nodeContextFileSystem: AgentContextFileSystem = {
  list: async (root, limit) => {
    const found: string[] = [];
    await walk(root, '', limit, found);
    return found;
  },
  stat: async (root, relativePath) => {
    const real = await inside(root, relativePath);
    const info = await stat(real);
    return { isFile: info.isFile(), size: info.size };
  },
  read: async (root, relativePath) => readFile(await inside(root, relativePath)),
};
