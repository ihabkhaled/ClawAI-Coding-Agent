import { build, context } from 'esbuild';
import { copyFile, cp, rm } from 'node:fs/promises';
import process, { argv } from 'node:process';
import { emitSdkTypes } from './scripts/emit-sdk-types.mjs';

const watch = argv.includes('--watch');
// playwright-core is ~7 MB of the 10 MB extension bundle and is only needed once
// an agent opens a browser. It ships as its own file that the extension requires
// on first use, so activation parses ~3 MB instead of ~10 MB.
const PLAYWRIGHT_RUNTIME = './playwright-runtime.js';
const lazyPlaywright = {
  name: 'lazy-playwright',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^playwright-core$/ }, () => ({
      path: PLAYWRIGHT_RUNTIME,
      external: true,
    }));
  },
};

const playwrightRuntimeOptions = {
  bundle: true,
  stdin: { contents: "module.exports = require('playwright-core');", resolveDir: process.cwd() },
  format: 'cjs',
  logLevel: 'info',
  minify: false,
  outfile: 'dist/playwright-runtime.js',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

const options = {
  bundle: true,
  entryPoints: ['src/extension.ts'],
  plugins: [lazyPlaywright],
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  minify: false,
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

// The MCP client reaches cross-spawn, a CommonJS package that requires Node builtins;
// an ES module bundle has no `require`, so it is given one.
const requireShim =
  "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);";

// The headless runner is a second product surface, not a variant of the first.
// It never imports vscode, runs as its own process, and is bundled separately so
// that shipping the extension cannot accidentally make it depend on a host.
const headlessOptions = {
  bundle: true,
  entryPoints: ['src/headless/headless-main.ts'],
  // Runnable as the package's `clawai` bin, not only through `node`.
  banner: {
    js: `#!/usr/bin/env node
${requireShim}`,
  },
  format: 'esm',
  logLevel: 'info',
  minify: false,
  outfile: 'dist/headless.mjs',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

// The SDK is a library, not a program: no entry side effects, and bundled so a
// caller gets one file rather than a source tree that depends on this repo's
// build settings.
const sdkOptions = {
  bundle: true,
  entryPoints: ['src/sdk/index.ts'],
  banner: { js: requireShim },
  format: 'esm',
  logLevel: 'info',
  minify: false,
  outfile: 'dist/sdk.mjs',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

async function copyNativeRuntime() {
  await copyFile('node_modules/playwright-core/browsers.json', 'browsers.json');
  await rm('dist/prebuilds', { recursive: true, force: true });
  await cp('node_modules/node-pty/prebuilds', 'dist/prebuilds', { recursive: true });
  await cp('node_modules/@homebridge/node-pty-prebuilt-multiarch/prebuilds', 'dist/prebuilds', {
    recursive: true,
    force: true,
  });
}

if (watch) {
  await copyNativeRuntime();
  const buildContext = await context(options);
  await buildContext.watch();
  await (await context(playwrightRuntimeOptions)).watch();
} else {
  await build(options);
  await build(playwrightRuntimeOptions);
  await build(headlessOptions);
  await build(sdkOptions);
  // dist/sdk.d.mts: the SDK's public types, emitted from tsconfig.sdk-types.json.
  await emitSdkTypes();
  await copyNativeRuntime();
}
