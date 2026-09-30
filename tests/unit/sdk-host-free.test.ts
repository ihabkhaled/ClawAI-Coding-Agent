import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

/**
 * The SDK and the headless runner must run where there is no editor.
 *
 * Bundles each entry the way the release build does and walks the resolved
 * import graph. `vscode` is marked external so an import of it is recorded
 * rather than failing resolution, which is what makes the assertion specific.
 */
async function importedModules(entry: string | { contents: string }): Promise<string[]> {
  const result = await build({
    ...(typeof entry === 'string'
      ? { entryPoints: [entry] }
      : { stdin: { contents: entry.contents, resolveDir: '.', loader: 'ts' as const } }),
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    format: 'esm',
    external: ['vscode'],
    logLevel: 'silent',
  });
  return Object.values(result.metafile.inputs).flatMap((input) =>
    input.imports.map((entryImport) => entryImport.path),
  );
}

describe('host-free graph', () => {
  it('detects a vscode import when one exists', async () => {
    const imports = await importedModules({ contents: "import 'vscode';" });

    expect(imports).toContain('vscode');
  });

  it.each([
    'src/sdk/index.ts',
    'src/headless/headless-main.ts',
    'src/headless/mcp/mcp-login-command.ts',
  ])(
    '%s never imports vscode',
    async (entry) => {
      const imports = await importedModules(entry);

      expect(imports.length).toBeGreaterThan(0);
      expect(imports).not.toContain('vscode');
    },
    30_000,
  );
});
