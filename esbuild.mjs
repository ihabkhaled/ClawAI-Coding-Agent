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
  await copyNativeRuntime();
}
