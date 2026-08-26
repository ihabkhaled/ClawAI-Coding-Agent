# Current Coding Agent Laboratory Baseline

Captured on 2026-08-26 before Wave 0 implementation.

| Identity                | Value                                                                 |
| ----------------------- | --------------------------------------------------------------------- |
| Extension source        | `32ffe45ff4534ddcd498cce8863f11d6c3ff5ff2` (Wave 0 plan on `v0.64.2`) |
| Parent platform         | `184f1bed25a2e998e1b4cc8a2d2a6791096ad376`                            |
| Parent recorded gitlink | `0f38df9c` (different from the checked-out extension)                 |
| VS Code                 | `1.135.0`, Windows x64                                                |
| Source checks           | PASS: 167 files, 1,146 tests                                          |
| Coverage                | 94.82% statements, 89.33% branches, 96.31% functions, 95.23% lines    |
| Extension host          | PASS: development extension activated and exited 0                    |
| Playwright              | FAIL: 39 passed, six deterministic stale screenshot failures          |
| Installed extension     | `clawai.clawai-coding-agent@0.64.2`                                   |

This baseline does not prove installed-VSIX behavior for a Wave 0 candidate.
Live backend/provider, competitor, soak, and self-hosting evidence is absent.

## Wave 0 source candidate

The settled 0.64.3 source passes format, lint, strict typecheck, absolute-path
scan, the 39-file critical coverage scope, 167 test files with 1,147 tests,
build, package audit, VS Code 1.135.0 extension-host activation, 45 Playwright
tests, and the production dependency audit. Artifact and installed-profile
identity are recorded after the source commit is frozen.
