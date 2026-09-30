import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface DiscoveredOperation {
  readonly tool: string;
  readonly operation: string;
}

const DEFINITION_START = /export const \w*(?:Tool)?Definition\w*: ToolDefinition = \{/gu;
const NAME = /\bname:\s*(?:'([^']+)'|([A-Z][A-Z0-9_]+))\s*,/u;
const OPERATIONS = /\boperations:\s*\[([^\]]*)\]/u;

function operationsOf(list: string): string[] {
  return [...list.matchAll(/'([^']+)'/gu)].flatMap((match) => match.slice(1, 2));
}

/** The string a `const NAME = '...'` declaration under `src` gives an identifier. */
function constantValue(root: string, identifier: string): string {
  const declaration = new RegExp(String.raw`\bconst ${identifier}\s*=\s*'([^']+)'`, 'u');
  const stack = [join(root, 'src')];
  for (let directory = stack.pop(); directory !== undefined; directory = stack.pop()) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith('.ts')) {
        const value = declaration.exec(readFileSync(path, 'utf8'))?.slice(1, 2)[0];
        if (value !== undefined) return value;
      }
    }
  }
  throw new Error(`Cannot resolve the tool name constant ${identifier}`);
}

function definitionsIn(source: string, root: string): DiscoveredOperation[] {
  const found: DiscoveredOperation[] = [];
  for (const start of source.matchAll(DEFINITION_START)) {
    const body = source.slice(start.index + start[0].length);
    const name = NAME.exec(body);
    const operations = OPERATIONS.exec(body);
    if (name === null || operations === null) continue;
    const literal = name.slice(1, 2)[0];
    const identifier = name.slice(2, 3)[0];
    const tool = literal ?? constantValue(root, identifier ?? '');
    for (const operation of operationsOf(operations.slice(1, 2).join(''))) {
      found.push({ tool, operation });
    }
  }
  return found;
}

/**
 * Every tool operation the runtime can be asked to run, read from the tool
 * definitions the executors export.
 *
 * Read from source rather than imported: the executors import `vscode`, which
 * a unit test cannot load. A definition this scan cannot read is a definition
 * the "every operation is classified" test cannot see, so the scan is itself
 * checked against a floor in the test.
 */
export function discoverToolOperations(root: string): readonly DiscoveredOperation[] {
  const files = [
    ...readdirSync(join(root, 'src/infrastructure'))
      .filter((name) => /-(?:tool-executor|fixture-executor)\.ts$/u.test(name))
      .map((name) => join(root, 'src/infrastructure', name)),
    join(root, 'src/core/mcp/mcp-tool-definition.ts'),
  ];
  const seen = new Map<string, DiscoveredOperation>();
  for (const file of files) {
    for (const item of definitionsIn(readFileSync(file, 'utf8'), root)) {
      seen.set(`${item.tool}.${item.operation}`, item);
    }
  }
  return [...seen.values()].sort((a, b) =>
    `${a.tool}.${a.operation}`.localeCompare(`${b.tool}.${b.operation}`),
  );
}
