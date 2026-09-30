# Extend it

You can teach ClawAI your project's rules, add your own commands, and connect extra
tools. Most of it lives in a `.clawai` folder at the top of your project, which is
safe to commit and share with your team as long as it holds no secrets.

## The .clawai folder

Run **ClawAI: Initialize .clawai** to create starter files: `rules.md`,
`architecture.md`, `memory.md`, `ignore`, four notes in `context/`, four in `skills/`
and two in `prompts/`. It asks you to confirm, only adds files that are missing, and
needs a trusted workspace. The other items in the table you create yourself.

| Path                           | What it is for                                                      |
| ------------------------------ | ------------------------------------------------------------------- |
| `.clawai/rules.md`             | Rules the agent must follow in this project.                        |
| `.clawai/architecture.md`      | How the code is organized and which parts may depend on which.      |
| `.clawai/memory.md`            | Lasting lessons worth remembering (no secrets).                     |
| `.clawai/context/*.md`         | Facts about your product, API, data and tests.                      |
| `.clawai/prompts/*.md`         | Reusable review and planning instructions.                          |
| `.clawai/ignore`               | Files ClawAI must not read: one pattern per line, `#` for comments. |
| `.clawai/skills/*.md`          | Your slash commands (below).                                        |
| `.clawai/output-styles/*.md`   | Your response styles (below).                                       |
| `.clawai/policies/policy.json` | Extra limits for the agent (below).                                 |
| `.clawai/agents/agents.json`   | Named helper personas for sub-agents.                               |
| `.clawai/mcp.json`             | Extra tool servers (below).                                         |
| `.clawai/workflows/*.json`     | Saved workflows and templates (below).                              |
| `.clawai/plugins/`             | Plugins installed for this project.                                 |

Only `rules.md`, `architecture.md` and `memory.md` are read automatically. A subfolder
can have its own `.clawai` with the same three files, and the ones closest to the
file you have open are read last. The notes in `context/` and `prompts/` are for you
and your team; ClawAI does not load them by itself. **ClawAI: Open Global Rules** and
**ClawAI: Open Global Skills** open a notes file that applies to all your projects in
this VS Code profile and is read first. The full layout is in
[the folder specification](../CLAWAI_FOLDER_SPEC.md).

## Skills and slash commands

Every `.md` file in `.clawai/skills/` is a slash command. `review.md` becomes
`/review`, typed at the start of a message. Typing `/` shows the list.

```markdown
---
name: code-review
description: Review a diff for correctness and security
argument-hint: <path>
---

Review $ARGUMENTS for correctness, security and missing tests.
```

- The top block is optional. Without a `name`, the file name is the command name.
  Names use lowercase letters, digits and hyphens.
- `$ARGUMENTS` is everything typed after the command. `$1` to `$9` are single words.
  If the file has no placeholder, what you typed is added to the end.
- The starter skill files (`typescript.md`, `react.md`, `node.md`, `nestjs.md`) become
  commands too, such as `/typescript`. Delete the ones you do not want.
- ClawAI ships `/security-review`. A command with the same name in your project
  replaces it.
- An unknown command is sent as ordinary text.

## Output styles

A file in `.clawai/output-styles/` (for example `house.md`) defines a way answers
are written. Choose one with **ClawAI: Select Output Style** or the `outputStyle`
setting. Built in: `default`, `concise`, `explanatory` and `learning`.

## Hooks

A hook runs your own command at a moment in a run. Add them in VS Code
settings under `clawAI.hooks`, not in `.clawai`, so that cloning a repository is not
enough to run code on your machine. Keep hooks you trust in your **user** settings.

```json
"clawAI.hooks": [
  { "event": "before-tool", "toolGlob": "workspace.command",
    "command": "node", "arguments": ["scripts/check-command.mjs"], "blocking": true }
]
```

- Events: `run-start`, `run-end`, `before-tool`, `after-tool`. `toolGlob` is an
  optional pattern for the tool's name; `workspace.command` is the command tool.
- Only a `before-tool` hook marked `blocking` can stop a call, when it exits with a
  failure. Every other hook is advisory. A hook that takes longer than 10 seconds
  is stopped and does not block anything.
- Hooks run without a shell, only in a trusted workspace.

## Project policy

`.clawai/policies/policy.json` can only make the agent stricter. Rules can ask or
deny by tool, path, command or web host, for example `{ "commandGlob": "git push*",
"outcome": "deny", "reason": "pushes are manual here" }`. It cannot grant more than
your approval mode allows. The editor checks the file as you type.

## Plugins and marketplaces

A plugin bundles commands, styles, hooks, helper personas and tool servers. It is a
folder containing a `clawai-plugin.json` with a name, publisher, version and what it
provides.

1. Run **ClawAI: Manage Plugins**, or open the **Plugins** view.
2. Choose install from a folder, then install for **User** (all projects) or
   **Workspace** (this project's `.clawai/plugins`).
3. Make sure it is enabled. A plugin's hooks stay off until you turn them on and confirm the
   exact commands.

**ClawAI: Browse Plugin Marketplaces** lists plugins from catalogs you add with the
`clawAI.pluginMarketplaces` setting: an https link to a `clawai-marketplace.json`, a
`git+https://...#ref` repository or a local folder. Each plugin is checked against
a fingerprint the catalog pins before it installs. An organization can limit which
catalogs are allowed. With the `clawAI.pluginSignaturePolicy` setting you can also
ask that plugins be signed by a publisher you trust (`off`, `warn` or `require`;
the default is `warn`), listing trusted publishers in `clawAI.trustedPluginPublishers`.

## MCP servers

MCP is a common way to connect extra tools and data, such as a filesystem, an issue
tracker or a database, to an AI agent. Describe servers in `.clawai/mcp.json` (this
project) or the `clawAI.mcpServers` setting (all projects; it wins a name clash).
Local servers use `command` and `args`; remote ones use an `https` `url` and can sign
in with OAuth.

Local servers only start in a trusted workspace, and **every** listing and call of
an MCP tool asks for your approval. Your organization can allow or deny servers.

## Workflows and templates

Files in `.clawai/workflows/` are shared with your team. Run one with **ClawAI: Run
Saved Workflow**. A template has a `name`, `description`, `instruction`, optional
`steps` and `acceptanceChecks`, and `"kind": "template"`. You can also ask the agent
to save a workflow or template; it asks first and will not overwrite unless told to.

## Scheduled tasks

Ask the agent, for example: "Every 30 minutes, check whether the build is green, 5
times." It creates a scheduled task after you approve.

- You can also give a calendar schedule, for example "weekdays at 9:00" or "every Monday at 08:30". The agent turns it into five fields (minute hour day-of-month month day-of-week, in your computer's local time). Names such as `MON` are not understood, and it cannot fire more often than every 5 minutes.
- Repeats run every 5 minutes to 7 days, up to 100 times (10 unless you say
  otherwise). A one-off can be set up to 30 days ahead. Up to 20 tasks per project.
- Tasks run only while VS Code is open. A one-off that came due while it was
  closed is dropped, and a repeating task carries on from the next interval without
  catching up. Only trusted workspaces can schedule.
- Each run uses your normal approval mode and asks like any other run.
- **ClawAI: Manage Scheduled Tasks** lists them and deletes any you pick.

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
