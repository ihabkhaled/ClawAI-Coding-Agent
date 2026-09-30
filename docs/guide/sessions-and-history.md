# Sessions and history

Every conversation is saved to your ClawAI account, so you can come back to it
later, from another window, or from another machine.

**Needs:** your ClawAI backend, which stores conversations. If you are signed out,
history is not shown.

## Finding a conversation

- The **History** view in the ClawAI sidebar lists your recent conversations. The
  `clawAI.historyLimit` setting controls how many are shown (50 by default).
- The chat panel also has a conversation history menu.
- **New ClawAI chat** opens a fresh conversation. You can keep several chat tabs
  open, and two of them can run at the same time with different models.
- Closed a chat by accident? Press `Ctrl+Alt+T` (**ClawAI: Reopen Closed Chat**).
- To search what the agent did, press `Ctrl+Alt+H` (**ClawAI: Search Run History**).
  Type part of the goal, and optionally narrow by outcome such as completed,
  cancelled or resumable. Results open as a safe, redacted summary.

## Rename, group, archive

- **ClawAI: Rename Conversation**: a name you will recognize next week beats the
  automatic title.
- **ClawAI: Group Conversation**: file a conversation into a named group, create a
  new group, or take it out of one. Groups are labels kept on this computer for
  this project. They are not stored on the server, so they do not follow you to
  another machine.
- **ClawAI: Archive Conversation**: hides a conversation from the list without
  deleting it.
- **ClawAI: Restore Archived Conversation**: brings an archived one back.

## Export and recap

- **ClawAI: Export Transcript** saves a conversation as Markdown or JSON to a place
  you choose. Nothing is written until you pick the destination.
- **ClawAI: Session Recap** gives a short summary of a run: the goal, how many
  files changed, how many tool calls, whether anything failed, and what to do next.
- **ClawAI: Show Usage** shows what your account has used today, this week and this
  month, and which features are limited. When your backend supports it, it also
  shows your last 30 days by model.

## Keep going in a shorter conversation

**ClawAI: Compact Conversation** summarizes the conversation and continues in a
new one. The original stays in your history. See [Chat and the agent](chat-and-agent.md).

## Resume from the web or another machine

**ClawAI: Resume Conversation from Another Surface** lets you pick up a
conversation that started somewhere else:

1. Run the command. You see your coding-agent conversations (from this or another
   machine, or from the command line) and your conversations from the ClawAI web
   app. Each is labeled with where it came from.
2. Pick one. If a reply may still be generating on another device, you are asked
   whether to **Stop That Run** or **Open Anyway**.
3. The conversation opens with its full history, and your next message continues
   it.

**Needs:** your ClawAI backend. If your backend is older, ClawAI falls back to a
rougher check for a run that is still active.

The list also has **Attach to a runner session...**, for work running on a machine
you set up as a runner. It shows the session's output and lets you continue in a
chat; see [Remote and automation](remote-and-automation.md).

Resume brings the conversation across, not your local files: the code on the other
machine stays there.

## Open in a new window

**ClawAI: Open Conversation in New Window** opens the same folder in a second VS
Code window and shows the conversation there, so you can keep it beside a different
set of files. It needs a folder open. Other useful layout commands:

- **ClawAI: Move Chat to Secondary Side Bar** keeps chat on the right while you
  browse files on the left.
- **ClawAI: Toggle Focus View** (`Ctrl+Alt+F`) shows only the conversation and
  the message box. The `clawAI.viewDensity` setting keeps your choice.

## Other views in the sidebar

- **Needs You**: approvals and questions waiting on you, plus runs that failed.
- **Tasks**: the agent's own to-do list for the current run.
- **Findings**: problems found by reviews, security checks and scanners.
- **Delivered Files**: files the agent produced for you.
- **Context**: what was sent for each request. See
  [Files and attachments](files-and-attachments.md).
