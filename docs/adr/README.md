# Architecture decision records

One file per decision, numbered, never renumbered. A decision that is replaced
gets a new ADR that says what it supersedes; the old one keeps its text.

| ADR                                                            | Decision                                                               | Status                |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------- |
| [0001](0001-uri-handler-navigation-only.md)                    | A `vscode://` handler for navigation only, never for authorization     | accepted, reversible  |
| [0002](0002-mcp-oauth-uses-the-loopback-callback.md)           | MCP server OAuth returns to the loopback callback, not the URI handler | accepted              |
| [0003](0003-permission-modes-under-an-organization-ceiling.md) | Permission modes are user choices under an organization ceiling        | accepted              |
| [0004](0004-goal-declared-flagship-stages.md)                  | Goal mode generalizes `runtime.flagship` with goal-declared stages     | accepted, 2026-09-30  |
| [0005](0005-cross-window-mailbox.md)                           | Cross-window messaging is a per-user file mailbox                      | accepted, 2026-09-30  |
| [0006](0006-plugin-publisher-signatures.md)                    | Plugin catalog entries carry detached Ed25519 publisher signatures     | accepted, 2026-09-30  |
| [0007](0007-secure-by-default-plugins-hooks-network.md)        | Plugins, hooks and plugin network access are secure by default         | accepted, in progress |
| [0008](0008-ship-gate-ci-parity.md)                            | `npm run ship` is the only way to main and its gate mirrors CI         | accepted, 2026-09-30  |

Write a new ADR when a change fixes a boundary, a protocol, a security
posture or a deliberate trade-off that a later reader would otherwise undo.
