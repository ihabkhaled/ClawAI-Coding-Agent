# Wave 0 Release Evidence

Evidence captured on 2026-08-26 in the main worktree on Windows x64. This is
candidate evidence, not proof of publication or production deployment.

## Automated gates

| Probe                              | Result                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| `npm run package:audit`            | PASS: 23 commands, 13 locales, strict CSP, no secret settings |
| `npm run check`                    | PASS: 167 files, 1,147 tests, build and package audit         |
| Critical coverage scope            | PASS: 39 required files, none missing                         |
| Coverage                           | PASS: 93.83% statements, 87.71% branches, 95.64% functions    |
| VS Code extension host             | PASS: VS Code 1.135.0 activation exited 0                     |
| Production dependency audit        | PASS: 0 vulnerabilities                                       |
| Runtime backend-client integration | PASS: 1 file, 5 tests                                         |
| Playwright snapshot refresh        | PASS: 45 tests; six expected Windows images regenerated       |
| Playwright unchanged replay        | PASS: 45 tests; no further snapshot changes                   |

The runtime integration probe verifies authenticated requests for protocol
negotiation, run start, resumable SSE, result submission, steering, and cancel.
Checkpoint persistence is local extension state; the client does not call or
document a public checkpoint endpoint.

## Visual review

| Baseline                         | Verdict                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `signal-desk-parallel-win32.png` | PASS: both active runs and targeted cancel controls remain visible               |
| `signal-desk-compare-win32.png`  | PASS: comparison cards, model choices, and composer controls remain legible      |
| `signal-desk-narrow-win32.png`   | PASS: 320px settings and composer remain contained without horizontal clipping   |
| `workbench-agent-run-win32.png`  | PASS: run status, changed-file receipt, and composer remain visible              |
| `workbench-narrow-win32.png`     | PASS: error state and primary controls remain usable at 320px                    |
| `workbench-light-win32.png`      | PASS: light-theme text, borders, controls, and focusable surfaces remain legible |

The refreshed images match the intentional compact status/run presentation and
composer focus treatment already present in source. Non-composer keyboard
controls retain visible boundaries. Forced-colors behavior also passes the
Playwright assertion.

## Remaining release evidence

The VSIX contains 126 files with no `.clawai-lab` or `.superpowers` content.
Operator and verifier profiles both install `clawai.clawai-coding-agent@0.64.3`;
each exact installed directory activates in VS Code 1.135.0 and passes the host
command/config assertions. Release parity has no local failures and its wrong-
installed-version negative control detects the mismatch.

| Artifact   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| VSIX       | `da65ab0c75ddc90fbb4aaa758ef77dc3e18865a1166becb65fc9b691a6a6b900` |
| CycloneDX  | `f851975d6c095ed70963274d8224e56290a8b587d10657e19188dc496ccec400` |
| SPDX       | `31cc110cc1610b0328fe8b8e33ad738bd3099fee88274a649488b9cc7768618c` |
| Provenance | `0fa255e49eed87151ae731ef1815134a27d6958ebaac6910709f47a9fe4c860c` |

Installed extension-host visual workbench replay, durability, chaos, fuzz,
mutation, scale, self-hosting, and live-provider lanes remain open. Public push,
tag, GitHub release, Marketplace publication, and production deployment remain
approval gates.
