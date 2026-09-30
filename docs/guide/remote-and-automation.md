# Remote and automation

This page covers running ClawAI without sitting at the chat box: from a terminal,
from another device, on a schedule, or with alerts.

Each section says what it needs. A **ClawAI backend** need means it relies on
something your ClawAI backend or account provides. **Needs a paired device** or
**Needs a runner** means a second machine or phone set up for ClawAI.

## Command-line mode

The extension includes a command-line runner for scripts and CI. It works on a
folder without opening VS Code.

**Needs:** Node.js 22.13 or newer, and a ClawAI credential in environment variables.

```bash
clawai -p "Explain the failing test in src/cart" --workspace ./my-project
```

The runner file is `dist/headless.mjs` in the extension's install folder. If a
`clawai` command is not on your path, run `node <install folder>/dist/headless.mjs -p "..."`.

- **Credential:** set `CLAW_TOKEN`, or `CLAW_EMAIL` and `CLAW_PASSWORD`. It is
  never printed. It does not reuse your VS Code sign-in.
- **Backend address:** `--backend-url`, or `CLAW_BACKEND_URL`. The default is
  `https://claw.local/api/v1`; for hosted ClawAI use `https://claw-ai.co/api/v1`.
- **Safe by default:** only reading and Git information are allowed. Add abilities
  with `--allow-tools read,write,command,git`, and name each program a command may
  use, for example `--allow-command npm`.
- **Other options:** `--model`, `--provider`, `--max-turns`, `--resume <id>`,
  `--continue`, `--permission-mode plan|ask|accept-edits`, and
  `--output-format text|json|stream-json` (`--json` is a shortcut). Run it with
  `--help` to see every option your version supports.
- **Exit codes:** 0 done, 1 failed, 2 usage error, 3 sign-in problem, 4 permission
  denied, 5 budget used up, 130 cancelled.

Command-line conversations appear in your history, marked as coming from the
command line, and can be resumed in VS Code. See
[Sessions and history](sessions-and-history.md).

## Remote control

Lets you send a command to this editor from ClawAI and run it here.

**Needs:** a ClawAI backend that supports remote commands, and a trusted folder open.
This editor is either a remote-control target or a runner (below), never both at once:
starting one stops the other.

1. Run **ClawAI: Start Remote Control**.
2. Commands queued for this editor in ClawAI show a confirmation on this computer
   with the exact command and folder. Nothing runs until you choose **Run**. If you
   do not answer within two minutes, it is refused.
3. A short list of harmless read-only commands, such as `git status` or `ls`, runs
   without asking. Commands with pipes, redirects or chaining are refused.
4. Run **ClawAI: Stop Remote Control** to switch it off. If it fails repeatedly it
   stops itself and tells you.

This is for running commands on this machine. It does not let another device steer
a chat inside your editor.

## Pairing and remote jobs

**ClawAI: Pair This Editor From Your Phone** shows a QR code and a link. Scan the
code or open the link on your phone, signed in to ClawAI, and approve. The editor
is then paired. Pairing on its own does not start anything.

**Needs a paired device:** **ClawAI: Run Remote Job Now** lists jobs you or the agent
created for a paired device and starts one on demand. If none exist it says so.

## Runners, cloud sessions and routines

A **runner** is a machine you own that takes jobs from ClawAI. ClawAI does not
provide hosted runners.

**Needs a runner:**

- **ClawAI: Register This Machine as a Runner** needs a trusted folder open. It
  names this machine, lets you add labels, and asks whether every tool call needs
  your approval or read-only calls can run alone. Writes and commands always ask.
- **ClawAI: Start Cloud Coding Session** picks an online runner, a repository and a
  branch, then sends one command and follows its progress in an output panel.
  **ClawAI: Attach to Runner Session** follows one that is already running (read
  only) or shows how it ended, and can continue it in a chat.
  **ClawAI: Stop Cloud Coding Session** stops one that is still running.
- **ClawAI: Manage Cloud Routines** creates, pauses, resumes and deletes routines
  that run every 5 minutes to 7 days. An **agent prompt** routine runs on a runner
  with matching labels. A **shell command** routine needs a paired device. Both need
  your ClawAI backend to support routines.

## Channel alerts

Channels let outside systems, such as monitoring, send a message into your editor.

**Needs:** a ClawAI backend that supports channels.

1. Run **ClawAI: Show Channel Webhook**. Copy the address and secret. Send signed
   JSON to that address from your tool.
2. New messages appear as a notice. Choose **Send to Chat** to add it to your
   message, or **Open Link**.
3. **ClawAI: Check Channel Inbox** checks right now. Checking runs about once a
   minute for up to four hours per session and starts only after you have asked for
   the webhook.

## Slack notifications

Get a Slack message when a run finishes or fails while VS Code is in the background.

1. Create an incoming webhook in Slack.
2. Run **ClawAI: Configure Slack Notifications**, choose **Set webhook URL**, and
   paste it (it must be a `https://hooks.slack.com/services/...` address). It is
   kept in your operating system's credential store. **Remove webhook** turns it off.
3. Choose **Send test message** to check it.

**Needs:** nothing from your ClawAI account. This goes straight from VS Code to Slack.
Messages are short pointers, not transcripts.

See also [Extend it](extend-it.md) for scheduled tasks that run inside VS Code.

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
