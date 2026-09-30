import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The SDK ships `dist/sdk.d.mts`, emitted from `tsconfig.sdk-types.json`.
 *
 * Nothing is built here: the config is read and the public surface is
 * type-checked in memory with the same settings, so a public type that needs
 * the editor, or an entry that drags in the extension, fails before a release.
 */
const CONFIG_PATH = resolve('tsconfig.sdk-types.json');
const SMOKE_FILE = resolve('tests/types/sdk-public-api.ts');
// The MCP client is host-free too: its files are listed by name, not by folder,
// because `infrastructure/` and `services/` otherwise hold editor code.
const HOST_FREE_ROOTS = [
  'src/sdk/',
  'src/core/',
  'src/headless/',
  'src/infrastructure/mcp/',
  'src/infrastructure/process-terminator',
  'src/infrastructure/hardened-git',
  'src/services/mcp-server-registry',
];

function fromRoot(path: string): string {
  return relative(resolve('.'), resolve(path)).split(sep).join('/');
}

function parsedConfig(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(CONFIG_PATH, (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, resolve('.'), undefined, CONFIG_PATH);
}

describe('SDK declaration emit', () => {
  it('compiles only the SDK entry, declarations only, without vscode types', () => {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { include?: unknown };
    const config = parsedConfig();

    expect(raw.include).toEqual([]);
    expect(config.fileNames.map(fromRoot)).toEqual(['src/sdk/index.ts']);
    expect(config.options.emitDeclarationOnly).toBe(true);
    expect(config.options.declaration).toBe(true);
    expect(config.options.types).toEqual(['node']);
    expect(fromRoot(config.options.outDir ?? '')).toBe('dist/sdk-types');
  });

  it('reaches only host-free source and type-checks the public surface', () => {
    const config = parsedConfig();
    const program = ts.createProgram({
      rootNames: [...config.fileNames, SMOKE_FILE],
      // The smoke file lives outside `src`, so rootDir widens to the package.
      options: {
        ...config.options,
        rootDir: resolve('.'),
        noEmit: true,
        emitDeclarationOnly: false,
        declaration: false,
      },
    });
    const diagnostics = ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
    const sourceFiles = program
      .getSourceFiles()
      .map((file) => fromRoot(file.fileName))
      .filter((path) => path.startsWith('src/'));

    expect(diagnostics).toEqual([]);
    expect(sourceFiles).toContain('src/sdk/index.ts');
    expect(
      sourceFiles.filter((path) => !HOST_FREE_ROOTS.some((root) => path.startsWith(root))),
    ).toEqual([]);
  }, 60_000);
});
