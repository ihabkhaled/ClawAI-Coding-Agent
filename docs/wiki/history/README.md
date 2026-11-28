# History

<!-- akinator:generated:begin -->
<!-- Facts read from manifests, CHANGELOG.md, docs/changes, docs/adr and
     .ai/ledger. Rewritten on every run; write outside this block. -->

## Versions

| Manifest       | Version   |
| -------------- | --------- |
| `package.json` | `1.114.0` |

## Releases

Nothing detected.

## Change records

Nothing detected.

## Decisions

| Decision                                                                         | Status                                                                  | Path                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ADR 0001: a `vscode://` handler for navigation only, never for authorization     | accepted, and reversible — the handler can be removed without           | `docs/adr/0001-uri-handler-navigation-only.md`                    |
| ADR 0002: MCP server OAuth returns to the loopback callback, not the URI handler | accepted                                                                | `docs/adr/0002-mcp-oauth-uses-the-loopback-callback.md`           |
| ADR 0003: permission modes are user choices under an organization ceiling        | accepted                                                                | `docs/adr/0003-permission-modes-under-an-organization-ceiling.md` |
| ADR 0004: goal mode generalizes `runtime.flagship` with goal-declared stages     | accepted                                                                | `docs/adr/0004-goal-declared-flagship-stages.md`                  |
| ADR 0005: cross-window messaging is a per-user file mailbox                      | accepted                                                                | `docs/adr/0005-cross-window-mailbox.md`                           |
| ADR 0006: plugin marketplace entries carry detached Ed25519 publisher signatures | accepted                                                                | `docs/adr/0006-plugin-publisher-signatures.md`                    |
| ADR 0007: plugins, hooks and plugin network access are secure by default         | accepted (implementation in progress in the working tree on 2026-09-30) | `docs/adr/0007-secure-by-default-plugins-hooks-network.md`        |
| ADR 0008: `npm run ship` is the only way to main, and its gate mirrors CI        | accepted                                                                | `docs/adr/0008-ship-gate-ci-parity.md`                            |
| ADR 0009: Akinator is vendored and runs on every change, with no command         | accepted                                                                | `docs/adr/0009-akinator-runs-on-every-change.md`                  |

## Ledger

Nothing detected.

Regenerate with: `python skills/akinator/scripts/extract_history.py --write`
<!-- akinator:generated:end -->

## Owner notes

_Unknown - ask the owner and record the answer._
