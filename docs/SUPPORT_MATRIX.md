# Runtime support matrix

This matrix describes product support, not claims of testing performed for a particular build. A release delivery report records the environments actually exercised.

| Environment                                 | Tier             | Workspace execution                       | Browser                           | Containers                       | Elevation                                   | Notes                                     |
| ------------------------------------------- | ---------------- | ----------------------------------------- | --------------------------------- | -------------------------------- | ------------------------------------------- | ----------------------------------------- |
| Windows 11 x64                              | Certified target | Supported                                 | Supported with installed Chromium | Docker Desktop                   | Native helper required                      | Primary desktop target                    |
| Current macOS arm64/x64                     | Certified target | Supported                                 | Supported with installed Chromium | Docker Desktop/compatible engine | Native helper required                      | Current supported VS Code hosts           |
| Ubuntu LTS x64                              | Certified target | Supported                                 | Headless or visible               | Docker/Podman                    | `sudo`, `doas`, or `pkexec` helper required | Interactive authorization only            |
| Fedora current x64                          | Certified target | Supported                                 | Headless or visible               | Docker/Podman                    | `sudo` or `pkexec` helper required          | Interactive authorization only            |
| Debian stable x64                           | Certified target | Supported                                 | Headless or visible               | Docker/Podman                    | `sudo`, `doas`, or `pkexec` helper required | Interactive authorization only            |
| WSL2                                        | Certified target | Remote workspace semantics                | Forwarded/local browser           | Engine-dependent                 | Interactive Linux helper                    | No implicit Windows/Linux path conversion |
| VS Code Remote SSH                          | Certified target | Executes on remote extension host         | Forwarded/local when declared     | Remote engine                    | Remote interactive helper                   | Credentials remain owned by VS Code/OS    |
| Dev Containers                              | Certified target | Executes inside container                 | Forwarded/local when declared     | Declared engine only             | Usually unsupported                         | Target reconnect invalidates approvals    |
| Codespaces                                  | Preview          | Remote workspace semantics                | Forwarded browser                 | Environment-dependent            | Unsupported                                 | Capabilities degrade visibly              |
| VS Code Web / virtual workspace             | Preview          | Read-only unless provider declares writes | Browser-host dependent            | Unsupported                      | Unsupported                                 | No guessed filesystem capability          |
| Kali, Arch, Alpine, openSUSE, CentOS-family | Best effort      | Capability-probed                         | Capability-probed                 | Capability-probed                | Unsupported unless helper is verified       | No release certification claim            |
| Headless elevation                          | Unsupported      | N/A                                       | N/A                               | N/A                              | Denied                                      | Native consent cannot be bypassed         |

“Certified target” requires the matching release’s UAT evidence before a build may claim it was certified. Missing evidence downgrades that build to `unverified` even when the platform is a supported product target.

## Requirements and optional dependencies (1.83.0)

- **VS Code engine:** `^1.98.0` (`engines.vscode`). Node `>=22.13.0` is required
  to build, and by the headless CLI and SDK (`dist/headless.mjs`, `dist/sdk.mjs`).
- **Command sandbox** (`clawAI.commandSandbox.mode`: `off`, `auto`,
  `bubblewrap`, `seatbelt`, `docker`). Availability is probed by
  `command-sandbox-host-probe.ts`; a helper is probed only on the platform that
  can use it. Network is off unless `clawAI.commandSandbox.allowNetwork`.

  | OS      | Mechanism                                | Requires                                     | Notes                                                                                       |
  | ------- | ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
  | Linux   | `bubblewrap` (`bwrap`), or `docker`      | `bwrap` on PATH, or a Docker engine          | `auto` prefers the OS sandbox: no image, host toolchain kept.                               |
  | macOS   | `seatbelt` (`sandbox-exec`), or `docker` | `sandbox-exec` (ships with macOS), or Docker |                                                                                             |
  | Windows | `docker` only                            | Docker Desktop                               | No OS sandbox exists: `auto` reports none rather than presenting a job object as isolation. |

  A mode that names a mechanism the host lacks stops the command; it does not
  fall back to running unconfined. Verified only by unit tests of the wrappers
  and the probe; no certified-run evidence per OS exists in this repository.

- **Optional tools.** Each degrades to a clear refusal when missing:
  - Jupyter extension (`ms-toolsai.jupyter`) for `workspace.notebook`
    `run-cell` and `run-all`.
  - GitHub CLI `gh`, signed in, for pull requests, review and check monitoring.
  - `osv-scanner`, `npm` or `pip-audit` for the dependency audit; the first one
    present for the manifests found is used.
  - `git` for session worktrees, git marketplaces and checkpoints.
  - An installed Chromium (Playwright) for the browser tool.
  - Docker, only when the sandbox mode or the container tool needs it.
- **Remote and headless.** Remote control, runners and routines need an
  agent-service that has the 2026-09-30 migrations. The SDK and `clawai -p` run
  without VS Code, on Node 22.13 or later, against the same `/api/v1` backend.
- **Zero data retention** blocks uploads, artifact publishing and thread
  sharing on every OS; it is not a platform property.
