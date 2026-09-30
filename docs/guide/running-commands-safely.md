# Running commands safely

In agent mode, ClawAI can run commands for you: build, test, lint, start a dev
server. This page explains how you stay in charge.

## You approve commands

- In **Ask for Approval** and **Auto Edit** mode, every command asks first. You see
  the exact command and where it will run, and choose **Approve** or **Reject**.
- **Autonomous Scoped** lets routine work through, including ordinary build and
  test commands, but anything that publishes, deletes, touches production or needs
  admin rights still asks or is refused. Use it only in projects you trust.
- **Strict** refuses deleting, production and admin-level actions outright.
- **Plan** and **Plan mode** allow no commands at all.

See [Chat and the agent](chat-and-agent.md) for the full table.

Every command also runs with limits:

- A time limit and an output size limit. Output is trimmed and secrets in it are
  hidden.
- Only a short list of environment variables is passed on (such as `PATH` and
  `HOME`). A token or password set in your own environment is not visible to the
  command.
- It runs in a folder inside your workspace, not somewhere else on disk.

The **Open Run Terminal** command (**ClawAI: Open Run Terminal**) opens a ClawAI
terminal where you can follow a run like a build log.

## Long commands and background commands

Some commands take a long time or never end, such as a build, a test watcher or a
dev server.

- **Long commands** can report back early. If a command is still running after a
  set wait, the agent gets the output so far and carries on, and checks the command
  again later instead of freezing the conversation.
- **Background commands** start a process and return straight away with a receipt.
  The agent reads the process output later and can stop it when it is done.

The agent manages only processes it started itself. It does not stop programs that
were already running on your machine.

## Workspace Trust

VS Code asks whether you trust a folder when you open it. ClawAI follows that
choice:

- **Untrusted folder:** you can chat and ask read-only questions. ClawAI will not
  collect your whole workspace, change files, run commands, start local tool
  servers, run hooks or scheduled tasks.
- **Trusted folder:** all features work, still within your approval level.

If ClawAI says it needs a trusted workspace, use **Workspaces: Manage Workspace
Trust** from the Command Palette. Only trust folders you know are safe: a project
can contain instructions the agent reads.

## The optional sandbox

By default commands run with your own permissions, bounded by the limits above.
For stronger isolation, turn on the sandbox with the `clawAI.commandSandbox.mode`
setting:

| Mode         | What it does                                                                   |
| ------------ | ------------------------------------------------------------------------------ |
| `off`        | Default. No sandbox.                                                           |
| `auto`       | Uses the strongest sandbox your computer offers. Says "none" if there is none. |
| `bubblewrap` | Linux only. Writes are limited to the workspace and temp folders.              |
| `seatbelt`   | macOS only. Writes are limited to the workspace and temp folders.              |
| `docker`     | Runs in a container with only the workspace mounted. Needs an image to be set. |

Other sandbox settings:

- `clawAI.commandSandbox.dockerImage`: the container image to use for `docker`.
- `clawAI.commandSandbox.allowNetwork`: off by default, so sandboxed commands
  cannot reach the network. Turn it on only if your build needs it.

Important details:

- If you name a specific sandbox that your computer does not have, commands are
  **refused** rather than run without it. `auto` does not refuse: without a sandbox
  it runs the command with your permissions, and each command result reports that.
- On Windows there is no built-in sandbox. Use `docker` if you want isolation.
- Each command result says which sandbox was used, so you can check.

## Good habits

- Keep **Ask for Approval** for unfamiliar projects.
- Read the command before approving. If it is not something you would type
  yourself, reject it and say what you want instead.
- Add project rules that limit the agent further, such as forbidding pushes. See
  [Extend it](extend-it.md) and [Privacy and security](privacy-and-security.md).
