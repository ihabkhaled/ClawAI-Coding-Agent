---
name: setup-a-fresh-worktree
description: Install dependencies in a newly created ClawAI Coding Agent worktree on Windows so that build, typecheck, lint and tests all pass. Use whenever a worktree, clone or CI-less checkout reports UNMET DEPENDENCY, "Cannot find type definition file for 'vscode'", or an esbuild "No loader is configured for .node files" failure.
---

# Set up a fresh worktree

A new worktree has no `node_modules`. Installing it the obvious way fails twice
on Windows, and the second failure looks like a source bug rather than an
install problem.

## The command

```bash
npm ci --ignore-scripts
```

That is the whole setup. Then `npm run typecheck`, `npm run lint`,
`npm run test:unit`, `npm run test:integration` and `npm run build` all pass.

## Why plain `npm ci` fails

`@homebridge/node-pty-prebuilt-multiarch` runs `scripts/install.js`, which
spawns a child process. On Windows with Node 24 that spawn raises `EINVAL` and
`npm ci` aborts, leaving `node_modules` deleted. The visible symptom is a wall
of `UNMET DEPENDENCY` lines from `npm ls`, and `npm run typecheck` failing with
`TS2688: Cannot find type definition file for 'vscode'` — nothing is installed,
including `@types/vscode`.

The npm failure can also be reported as exit code 0 by a background task
wrapper. Read the tail of the actual log, not the summary.

## Why you must not "fix" it by supplying the native build

The tempting repair is to compile that package, or to copy a
`build/Release/` directory from another worktree that has one. Do not. Once
`node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/pty.node`
exists, `npm run build` fails:

```
X [ERROR] No loader is configured for ".node" files:
    node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release/pty.node
  node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/prebuild-loader.js:10:53
```

`lib/prebuild-loader.js` names `'../build/Release/pty.node'` in a static
`require`, and `lib/windowsPtyAgent.js` names `conpty.node` the same way.
`esbuild.mjs` bundles `src/extension.ts` with only `vscode` marked external and
declares no `.node` loader, so esbuild resolves those literals the moment the
files exist and refuses them. While the directory is absent the requires stay
unresolvable and esbuild leaves them alone.

Deleting that `build/` directory is the repair if a worktree already has one.

## PTY still works

Skipping the postinstall costs nothing on Windows or macOS. The separate
`node-pty` package ships real prebuilds for `win32-x64`, `win32-arm64`,
`darwin-x64` and `darwin-arm64`, and `copyNativeRuntime()` in `esbuild.mjs`
copies them into `dist/prebuilds`. `@homebridge/node-pty-prebuilt-multiarch`
only carries the `linux-*` multiarch fallback, and its prebuilds are copied
over the same directory.

## Verify

```bash
npm run typecheck && npm run lint && npm run test:unit && npm run build
```

Baseline figures for an untouched tree are in
[`docs/parity/BASELINE_EVIDENCE.md`](../../docs/parity/BASELINE_EVIDENCE.md).
