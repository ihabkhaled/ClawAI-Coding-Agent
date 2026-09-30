# ClawAI Coding Agent user guide

ClawAI Coding Agent puts your ClawAI workspace inside VS Code. You chat with
models, let an agent read and change your code, and stay in control: nothing
risky happens without your approval.

This guide is for people who installed the extension from the Marketplace. It
explains what you can do and how, in plain language.

## Start here

| If you want to...                                        | Read                                                  |
| -------------------------------------------------------- | ----------------------------------------------------- |
| Install, sign in, and finish your first task             | [Getting started](getting-started.md)                 |
| Understand chat versus agent, models, modes and approval | [Chat and the agent](chat-and-agent.md)               |
| Give the agent files, lines, images, PDFs or a terminal  | [Files and attachments](files-and-attachments.md)     |
| Let the agent run commands without losing control        | [Running commands safely](running-commands-safely.md) |
| Commit, open pull requests, review, and fix failed CI    | [Git and pull requests](git-and-pull-requests.md)     |
| Find, group, archive and resume conversations            | [Sessions and history](sessions-and-history.md)       |
| Add your own commands, hooks, plugins and tools          | [Extend it](extend-it.md)                             |
| Use the command line, remote control and alerts          | [Remote and automation](remote-and-automation.md)     |
| Know what leaves your machine                            | [Privacy and security](privacy-and-security.md)       |
| Change a setting                                         | [Settings](settings.md)                               |
| Fix a problem                                            | [Troubleshooting](troubleshooting.md)                 |

## What you get

- **One place for many models.** Let ClawAI pick a model for you, or choose one
  yourself, or compare several answers side by side.
- **An agent that does the work.** It reads your project, proposes edits, runs
  checks, and reports back. You approve what matters.
- **Control at every step.** Pick how often it asks, stop it at any time, undo
  its edits, and rewind a conversation to an earlier turn.
- **Your rules, your style.** Keep project rules, reusable commands and response
  styles in a `.clawai` folder that you can share with your team.
- **Privacy by default.** Secret-looking files are never read, secrets are
  hidden in logs, and a zero data retention mode is available.

## Before you begin

- VS Code 1.98 or newer.
- A ClawAI account, and a ClawAI backend to connect to: the hosted service or one
  you run yourself. The extension is the editor side of ClawAI. Models, sign-in,
  history, limits and organization rules all come from the backend.
- A trusted workspace for anything that reads your whole project or changes files.
  In an untrusted workspace you can still chat and ask read-only questions.

## Notes on this guide

- Some features only work when your ClawAI account or backend supports them, or
  when you have a second device or machine set up. Those pages say so plainly
  with lines that start with **Needs:**.
- Names in **bold** are what you see on screen. Command names appear as they do
  in the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on macOS), for example
  **ClawAI: Show Logs**.
- Keyboard shortcuts are given for Windows and Linux. On macOS use `Cmd` instead
  of `Ctrl`.

For the full list of changes in each version, see the
[changelog](../../CHANGELOG.md).

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
