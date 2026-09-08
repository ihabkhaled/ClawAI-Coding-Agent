# Installed-artifact evidence

Every batch in [`PROGRAM.md`](PROGRAM.md) shipped its code and deterministic
gates but recorded "installed-VSIX UAT not yet run". This closes that for the
five batches together, against the artifact that carries all of them.

## Artifacts

Each row was packaged, installed into its own disposable profile, and passed
`npm run test:host:installed`.

| Version | SHA-256                                                            | Batches carried |
| ------- | ------------------------------------------------------------------ | --------------- |
| 0.69.0  | `27dcda754bff89f28f63bb6bc4dbc92d19ac52ac7cef6d538f666aff24760a2a` | 1–5             |
| 0.70.0  | `6fdc065c83ff777a37da7756a4c54cf6c4c6a7d921ae742100189eeb41110f99` | 1–6             |

## The 0.69.0 run in full

| Fact    | Value                                                              |
| ------- | ------------------------------------------------------------------ |
| File    | `builds/clawai-coding-agent-0.69.0.vsix`                           |
| SHA-256 | `27dcda754bff89f28f63bb6bc4dbc92d19ac52ac7cef6d538f666aff24760a2a` |
| Size    | 17,340,566 bytes, 126 files                                        |
| Branch  | `feat/claude-parity-program`                                       |
| Host    | Windows 11 x64, VS Code stable, Node v24.18.0                      |

`vsce ls --tree` matches no `.ts`, no `tests/` and no `.map`, so no source,
tests or sourcemaps are packaged.

## Clean profile

Installed with a disposable user-data and extensions directory, never a
developer profile:

```bash
code --user-data-dir <tmp>/user-data --extensions-dir <tmp>/extensions \
     --install-extension builds/clawai-coding-agent-0.69.0.vsix --force
```

`--list-extensions --show-versions` reports exactly `clawai.clawai-coding-agent@0.69.0`,
and the extensions directory holds one ClawAI folder, so no earlier build is
shadowing it.

## Result

`npm run test:host:installed <extensions-dir>` runs the extension-host
assertions against the installed copy rather than the working tree, and passed:

- the extension resolves and its packaged version is 0.69.0;
- it activates, within the two-second activation budget;
- all 23 contributed commands are registered;
- `clawAI.agentMode` and `clawAI.permissionMode` still contribute their exact
  enums;
- no `onUri` activation event is exposed;
- `clawAI.openChat` executes and leaves the extension active.

## What this does and does not prove

It proves the packaged artifact is complete and activates as itself — the
failure modes that separate a working tree from a shipped VSIX: a
`.vscodeignore` that dropped a needed file, a stale `dist/`, a contribution that
did not survive packaging.

It does not prove the five features behave correctly against a live backend.
That needs an authenticated session, entitled models, and the real-agent
scenario matrix the pack describes, none of which run here. The webview
behaviour of batches 1, 4 and 5 is covered by the 51 Playwright tests against
the production webview bundle; the host-side behaviour of batches 1, 2, 3 and 5
is covered by 1,223 unit and integration tests. Neither is a substitute for a
live-model run, and no batch is claimed as fully DONE on this evidence alone.

## Repeating it

```bash
npm run package
code --user-data-dir <tmp>/user-data --extensions-dir <tmp>/extensions \
     --install-extension builds/clawai-coding-agent-<version>.vsix --force
npm run test:host:installed <tmp>/extensions
```
