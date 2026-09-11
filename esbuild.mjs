import { build, context } from 'esbuild';
import { copyFile, cp, rm } from 'node:fs/promises';
import { argv } from 'node:process';

const watch = argv.includes('--watch');
const options = {
  bundle: true,
  entryPoints: ['src/extension.ts'],
  external: ['vscode'],
  format: 'cjs',
  logLevel: 'info',
  minify: false,
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
};

// The headless runner is a second product surface, not a variant of the first.
// It never imports vscode, runs as its own process, and is bundled separately so
// that shipping the extension cannot accidentally make it depend on a host.
const headlessOptions = {
  bundle: true,
  entryPoints: ['src/headless/headless-main.ts'],
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
} else {
  await build(options);
  await build(headlessOptions);
  await build(sdkOptions);
  await copyNativeRuntime();
}
