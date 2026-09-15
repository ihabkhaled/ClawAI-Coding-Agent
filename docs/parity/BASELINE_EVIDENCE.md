# Claude-Parity Program — Gate A baseline evidence

Captured before any parity code was written, on branch `feat/claude-parity-program`.

## Identity

| Fact                 | Value                          |
| -------------------- | ------------------------------ |
| Extension version    | 0.64.4                         |
| Extension commit     | 454b34d                        |
| Monorepo commit      | 0c67a5668                      |
| Branch               | `feat/claude-parity-program`   |
| Worktree (extension) | `.worktrees/claude-parity-ext` |
| Worktree (monorepo)  | `.worktrees/claude-parity`     |
| Node                 | v24.18.0                       |
| Host                 | Windows 11 x64                 |

## Gate results on the untouched tree

| Gate          | Command                    | Result                              |
| ------------- | -------------------------- | ----------------------------------- |
| Type check    | `npm run typecheck`        | green                               |
| Lint          | `npm run lint`             | green, `--max-warnings=0`           |
| Unit          | `npm run test:unit`        | 164 files, 1117 tests passed        |
| Integration   | `npm run test:integration` | 6 files, 41 tests passed            |
| Bundle        | `npm run build`            | `dist/extension.js` 9.0 MB          |
| Package audit | `npm run package:audit`    | 23 commands, 13 locales, strict CSP |
| Formatting    | `npm run format:check`     | clean                               |

These numbers are the regression floor. A parity batch that lowers any of them is
not releasable.

## Local setup constraint discovered here

`npm ci` fails on Windows in a fresh worktree. The postinstall of
`@homebridge/node-pty-prebuilt-multiarch` spawns with `EINVAL`, and when that
postinstall does succeed it writes `build/Release/pty.node` and
`build/Release/conpty.node`, which breaks `npm run build`: `esbuild.mjs`
configures no loader for `.node`, and `lib/prebuild-loader.js` statically
requires that path once it exists.

Use `npm ci --ignore-scripts`. Runtime PTY on Windows is unaffected because the
`node-pty` package ships `win32-x64` and `win32-arm64` prebuilds, which
`esbuild.mjs` copies into `dist/prebuilds`; the `@homebridge` package only
supplies the Linux multiarch fallback.

Procedure: `skills/setup-a-fresh-worktree/SKILL.md`.
