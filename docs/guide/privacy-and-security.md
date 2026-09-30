# Privacy and security

This page explains what leaves your computer, what is kept private, and which
protections you can rely on.

## What is sent, and where

ClawAI Coding Agent is the editor side of your ClawAI backend. It talks to the
backend you chose at sign-in (Local, Cloud or Custom) and to nothing else by
default.

Sent to your ClawAI backend:

- Your messages, and the workspace context chosen for each request. The **Context**
  view shows exactly which files were included, left out or shortened.
- Attachments, uploaded when the request starts running.
- Web research requests, if you turn **Web research** on.

Your backend then routes the request to a model. Choosing **Local models only** or
**Privacy first** asks it to prefer models that keep your data closer to home.
Your prompts still go to your backend, which is why the backend's operator is part
of your trust.

Non-local backends must use HTTPS. Plain HTTP is only accepted for `localhost`,
`127.0.0.1` and `claw.local`.

Sent elsewhere only when you set it up:

| You set up              | What goes where                                                      |
| ----------------------- | -------------------------------------------------------------------- |
| Slack notifications     | A short run-finished message, to your Slack webhook.                 |
| Telemetry endpoint      | Run traces, to the OpenTelemetry collector you name. Off by default. |
| Pull requests           | Through your own `gh` sign-in, to GitHub.                            |
| MCP servers and plugins | To the servers and catalogs you add.                                 |
| Feedback                | Only after you read the report and choose **Send to ClawAI**.        |

The feedback report describes your installation: versions, system, language, backend
address and connection state, chosen modes and model, the last error (with secrets
hidden) and recent run ids, plus the title and notes you type. It has no prompts,
file paths or code.

## Secrets stay secret

- **Your password never enters VS Code.** You sign in in the browser. Sign-in
  tokens are kept in your operating system's credential store, never in settings,
  URLs or logs. **ClawAI: Log Out** clears them.
- **Secret-looking files are never read**, including `.env`, key files and files
  named like credentials (`id_rsa`, `passwords.csv`). They cannot be mentioned or
  attached, and every tool refuses them. You can add more exclusions in
  `.clawai/ignore`; you cannot remove the built-in ones.
- **Redaction.** Logs, command output, error messages and reports have tokens,
  passwords, API keys, cookies and `Bearer` values replaced with `[REDACTED]`.
- **Commands cannot see your tokens.** They inherit only a short list of ordinary
  environment variables.
- **Commits are scanned** for keys and tokens before they are made.
- **Thinking stays private.** ClawAI reports how much a model thought, never what it
  thought, and never stores or exports it.

## Zero data retention

Turn on `clawAI.zeroDataRetention` when nothing should be kept.

- Run history and checkpoints stay in memory for that session only.
- Every request asks the backend not to keep its content.
- Actions that need server storage are refused: uploading files, publishing pages,
  sharing chats, and comparing models.

If your organization sets a retention limit of zero days, this switches on for you.

## Organization rules

If you belong to an organization in ClawAI, its administrators can set rules that
apply to you automatically after you sign in. In plain words, they can:

- Limit which models and tools you may use.
- Cap how risky an action may be, and require approval for certain kinds of action.
- Set the loosest approval level you may choose. You can always choose a stricter
  one.
- Block specific paths, commands or websites, and list trusted repositories,
  websites and commands.
- Allow or block MCP servers, and limit which plugin catalogs you can install from.
- Set how long content may be kept.

Organization rules can only make things stricter. They cannot loosen the safety
rules built into the extension.

**Needs:** an organization set up in your ClawAI account.

## Protections that always apply

- **Workspace Trust:** in an untrusted folder, ClawAI cannot collect the workspace,
  change files or run commands.
- **Reviewed edits:** a file is changed only after the exact edit was previewed, and
  only if the file is unchanged since. Paths outside your folder, `.git` and
  credential files are rejected.
- **No surprise publishing:** commits, pushes and pull requests ask first, and
  deleting, production and admin-level actions have their own safeguards.
- **Approvals expire with context:** an approval covers one exact action and stops
  applying if the account, folder or rules change.
- **Links stay narrow:** a `vscode://` link can only open the chat or a conversation.
  It cannot send a message, run a command or approve anything.

## Tips

- Keep **Ask for Approval** for code you do not know.
- Review diffs. Approved generated code can still be wrong, so run your own tests.
- To report a suspected vulnerability, do not open a public issue. Follow the
  private reporting steps in [the security policy](../../SECURITY.md).

See also [Running commands safely](running-commands-safely.md) and
[Settings](settings.md).

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
