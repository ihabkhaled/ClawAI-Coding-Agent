# ClawAI Coding Agent for VS Code

ClawAI Coding Agent is the secure VS Code client for a ClawAI backend. It brings
streaming chat, backend-owned AUTO routing, manual model selection, model
comparison and judging, project-aware code workflows, explainable context
receipts, and preview-before-apply edits into the editor.

The extension remains a thin client. Authentication, entitlements, quotas,
thread history, provider credentials, routing, inference, and audit records stay
in the ClawAI platform.

## Highlights

- Stream responses from local or hosted ClawAI deployments.
- Use backend AUTO routing or reliably choose an entitled cloud, Ollama, or
  llama.cpp model manually.
- Chat from a workspace even when no editor tab is open.
- Switch between Auto execution and read-only Plan mode.
- Choose manual approvals, routine pre-approval, or Full Access while immutable
  safety boundaries remain enforced.
- Compare two to five models and optionally request a judge response.
- Ask about a selection, active file, or bounded workspace context.
- Generate, fix, review, test, document, plan, and audit code.
- Inspect every proposed file in VS Code diff editors before a modal approval.
- Undo the most recent ClawAI edit made during the current extension session.
- Keep project rules in `.clawai/` and profile-wide rules in extension storage.
- Use the interface in 13 locales, including RTL Arabic and Persian.

## Requirements

- VS Code 1.98 or newer.
- A reachable ClawAI backend and a ClawAI account.
- Workspace Trust for workspace-wide collection or any file modification.

Node.js is only required when developing or packaging the extension.

## Quick start

1. Install the VSIX or Marketplace release.
2. On first launch, enter the ClawAI app origin, such as
   `https://claw.local` or `https://localhost`. The extension adds `/api/v1`
   automatically.
3. Choose **Connect**, then approve VS Code in the ClawAI web app. Credentials
   are entered only in the web app; the extension receives a one-time
   authorization code and stores the resulting tokens in VS Code
   `SecretStorage`.
4. Keep **Automatic routing** selected or choose an entitled cloud/local model
   in the composer.
5. Choose **Auto** or **Plan mode**, then select the permission level appropriate
   for this workspace.
6. Ask a question, compare models, or run a ClawAI command from the Command
   Palette. Smart context works with a selection, file, workspace, or no files.

Use `Ctrl+Shift+A` (`Cmd+Shift+A` on macOS) to open chat and
`Ctrl+Shift+Enter` (`Cmd+Shift+Enter`) to ask about a selection.
You can also open VS Code Chat and address the stable `@clawai` participant.

## Local and hosted backends

The extension adds `/api/v1` to the configured backend origin. A pasted
trailing `/api/v1` is removed automatically. Do not include
credentials, tokens, query strings, or fragments in the URL.

Plain HTTP is accepted only for `localhost`, `127.0.0.1`, `::1`, or
`claw.local`. Every non-local backend must use HTTPS. The extension validates
every backend response at runtime and refreshes an expired session once before
retrying the request.

## Coding workflows

Read-only workflows return analysis in chat. Edit workflows require the backend
to return a bounded, validated edit plan. The extension rejects absolute paths,
parent traversal, `.git`, environment files, credential-like paths, malformed
operations, and oversized plans.

For every valid plan, the extension:

1. opens before/after diff previews;
2. asks for explicit modal approval;
3. checks Workspace Trust again;
4. applies one atomic `WorkspaceEdit`;
5. offers a session-scoped undo.

Routine context/edit-generation prompts follow the selected permission mode.
The final diff approval cannot be disabled by a setting.

## Context and `.clawai`

Workspace context is size- and file-bounded, excludes binary content, applies
VS Code and `.clawai/ignore` patterns, and always denies common secret paths.
The **Context** view shows exactly what was included, excluded, and truncated.

Run **ClawAI: Initialize .clawai** to create the documented project structure
without overwriting existing files. Use **Open Global Rules** and
**Open Global Skills** for profile-wide guidance. Global guidance is read before
project rules.

See [the `.clawai` specification](docs/CLAWAI_FOLDER_SPEC.md) for the complete
layout.

## Configuration

| Setting                   | Scope     | Default                                 |
| ------------------------- | --------- | --------------------------------------- |
| `clawAI.backendUrl`       | machine   | prompted on first launch                |
| `clawAI.requestTimeoutMs` | machine   | `60000`                                 |
| `clawAI.routingMode`      | workspace | `AUTO`                                  |
| `clawAI.agentMode`        | workspace | `AUTO`                                  |
| `clawAI.permissionMode`   | workspace | `MANUAL`                                |
| `clawAI.selectedModel`    | workspace | empty                                   |
| `clawAI.maxContextBytes`  | workspace | `200000`                                |
| `clawAI.maxContextFiles`  | workspace | `40`                                    |
| `clawAI.exclude`          | workspace | generated, build, secret, and VCS globs |
| `clawAI.historyLimit`     | window    | `50`                                    |

Secrets are deliberately not settings.

## Development

```bash
npm ci --ignore-scripts
npm run check
npm run test:host
npm run test:playwright
npm run package
```

Press `F5` to launch the Extension Development Host. CI runs formatting, lint,
strict typechecking, unit/integration coverage, bundling, package security
invariants, runtime dependency audit, VSIX creation, and a real VS Code
activation test.

Architecture, API, security, test, publishing, UX, and UAT references live in
[`docs/`](docs/).

## Status

Version `0.3.0` implements the production-ready extension surface from
the ClawAI VS Code coding-agent plan. See [CHANGELOG.md](CHANGELOG.md) and
[ROADMAP.md](docs/ROADMAP.md).

## License

[MIT](LICENSE)
