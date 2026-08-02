# ClawAI Coding Agent for VS Code

ClawAI Coding Agent is the secure VS Code client for a ClawAI backend. It brings
streaming chat, backend-owned AUTO routing, manual model selection, model
comparison and judging, project-aware code workflows, explainable context
receipts, and preview-before-apply edits into the editor.

The extension remains a thin client. Authentication, entitlements, quotas,
thread history, provider credentials, routing, inference, and audit records stay
in the ClawAI platform.

## Runtime foundation

Version 0.40.0 delivers the model-neutral Runtime Protocol V2 studio. Bounded
workspace, command, process, Git, container, database, quality, browser,
planning, service, journal, and evidence capabilities share one ordered,
policy-controlled execution loop. An unavailable or incompatible additive
endpoint keeps the supported V1 chat and reviewed edit workflow active.

## Highlights

- Stream responses from local or hosted ClawAI deployments.
- Keep multiple titled ClawAI chat tabs open, run two independent chats
  concurrently with different models, restore backend history in place, and
  preserve ordered follow-ups within each conversation.
- Use backend AUTO routing or reliably choose an entitled cloud, Ollama, or
  llama.cpp model manually.
- Chat from a workspace even when no editor tab is open.
- Paste, drop, or pick screenshots, images, videos, documents, and source files
  into the composer. Attachments stay visibly bound to the request that owns
  them and upload only when that queued request starts.
- Recall submitted prompts with Arrow Up and move forward again with Arrow Down.
- Switch between Auto execution and read-only Plan mode.
- Choose manual approvals, persistent per-workspace routine consent, or Full
  Access while immutable safety boundaries remain enforced.
- Compare two to five models in structured responsive result cards and
  optionally request a judge response.
- Ask about a selection, active file, or bounded workspace context.
- Generate, fix, review, test, document, plan, and audit code.
- Follow two request-owned run lanes and vivid reported/estimated token use for
  prompts, reasoning status, tools, files, responses, comparisons, and the
  current conversation.
- Approve changes inside the ClawAI workbench and open proposed VS Code diffs
  only when **Review changes** is selected.
- Run bounded development commands in visible VS Code task terminals after
  approved edits.
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
2. The focused connection screen starts with `https://claw.local`. Keep it or
   enter another ClawAI app origin such as `https://localhost`; `/api/v1` is
   added automatically.
3. Choose **Connect to ClawAI**, then approve VS Code in the ClawAI web app.
   Credentials are entered only in the web app; the extension receives a
   one-time authorization code and stores the resulting tokens in VS Code
   `SecretStorage`. The full workbench appears only after this succeeds.
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

1. freezes the selected workspace root and stages before/after diff previews
   from the live editor buffer without opening files;
2. offers an explicit **Review changes** action and requests approval inside the
   ClawAI workbench when required;
3. checks Workspace Trust, canonical path containment, and the reviewed
   before-state again;
4. rejects stale reviews or applies one atomic `WorkspaceEdit`;
5. runs validated development commands in a visible, cancellable task terminal;
6. offers a session-scoped undo.

In Manual mode, the first routine context/edit-generation prompt offers
**Always allow in this workspace**. That consent survives reloads and restarts
for the same trusted workspace. Full Access skips repeated routine context
and proposal-generation prompts and applies validated file changes
automatically. Development commands still require in-extension approval. Full
Access never bypasses Workspace Trust, secret/path exclusions, command
validation, or cancellation.

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
| `clawAI.backendUrl`       | machine   | `https://claw.local`                    |
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

Version `0.11.0` implements the current extension surface from the ClawAI VS
Code coding-agent plan. See [CHANGELOG.md](CHANGELOG.md) and
[ROADMAP.md](docs/ROADMAP.md).

## License

[MIT](LICENSE)
