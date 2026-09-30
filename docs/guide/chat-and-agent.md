# Chat and the agent

The chat box at the bottom of the ClawAI panel does several jobs. The **Run**
selector decides which one.

## Chat, agent, compare

| Run                 | What happens                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| **Agent**           | The agent reads your project, proposes edits, runs checks, and works in steps. |
| **Chat**            | A plain conversation. Good for questions, explanations and ideas.              |
| **Compare**         | Sends one prompt to 2 to 5 models and shows their answers side by side.        |
| **Compare + Judge** | The same, and then one more model judges the answers.                          |

Use **Chat** when you want to talk. Use **Agent** when you want work done.
The agent needs a model that can call tools. If the model you picked cannot, the
panel tells you that an agent run will not edit files, and you can pick another
model.

Other ways to start:

- `Ctrl+Shift+Enter` asks about the selected code.
- Right-click code and choose **Ask About Selection**, **Fix Selected Code** or
  **Review Selected Code**. Right-click a file in the Explorer for **Ask About
  File**.
- Type `@clawai` in VS Code's built-in Chat view.
- Send messages while a run is going. They queue up and run in order.
- Press the Up and Down arrows in the empty chat box to reuse earlier prompts.

## Choosing a model

The **Model** selector offers:

- **Automatic routing**: ClawAI picks a model for each request.
- A routing goal: **Local models only**, **Privacy first**, **Fastest reply**,
  **Strongest reasoning** or **Lowest cost**.
- A specific model from your account (cloud models, and local models your
  ClawAI backend serves).

If the list looks out of date, run **ClawAI: Refresh Models**. `Ctrl+Alt+M` opens
the model picker. **ClawAI: Toggle Fast Mode** switches on the fast-reply goal and
quicker context gathering in one step, and switches back when you toggle again.

## Effort and speed

- **Effort** (Low, Medium, High, Max, xHigh, Ultra) limits how much one run may
  spend: how many steps it takes, how many tools it uses, and how long it runs.
  **Low** is for quick edits (about 6 model turns, 5 minutes). **Ultra** is the
  default and gives the biggest budget (about 40 turns, up to 2 hours). Pick a
  lower level to keep small jobs cheap and short.
- **Speed** (1X, 1.5X, 2X) controls how many project files are checked at the same
  time while ClawAI gathers context. It changes how fast context is collected,
  not what is included and not what needs approval.

## Modes and approval

There are two controls under **More settings**.

**Agent** decides whether the agent may act:

- **Auto**: the agent can make changes, within your approval level.
- **Plan mode**: read-only. You get a plan and nothing is changed.

**Approval** decides how often you are asked:

| Approval              | What it means                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- |
| **Plan**              | Read-only. Anything that changes something is refused.                                       |
| **Ask for Approval**  | The default. You approve each change and command.                                            |
| **Auto Edit**         | Routine file edits go through without asking. Commands and riskier actions still ask.        |
| **Autonomous Scoped** | Low-risk work inside the workspace goes through. Publishing, deleting and similar still ask. |
| **Strict**            | Asks like Ask for Approval, and also refuses deleting, production and admin-level actions.   |

Some rules never change, whichever level you pick: untrusted workspaces are
read-only, secret-looking files are off limits, and your organization's rules (if
you belong to one) can lower the level you may choose but never raise it. See
[Privacy and security](privacy-and-security.md).

## Approvals

When the agent needs a decision, an **Approval required** card appears in the
chat, and a notice tells you ClawAI is waiting. The **Needs You** view in the
sidebar lists everything waiting for you, across chats.

1. Read what the agent wants to do.
2. Choose **Approve** or **Reject**.
3. In **Ask for Approval** mode the first routine request offers **Always allow in
   this workspace**, which is remembered for that trusted folder only.

An approval only covers the exact action shown. If the workspace changes in the
meantime, you are asked again.

## Stopping, undoing, rewinding

- **Stop**: the cancel button in the chat, or `Ctrl+Alt+Escape`.
- **Undo edits**: `Ctrl+Alt+Z` undoes the last ClawAI edit, up to twenty deep,
  until you switch folders.
- **Rewind to here**: on a saved message, choose **Rewind to here** to delete every
  later message in that conversation and continue from that point. You can also
  run **ClawAI: Rewind Conversation** and pick the message. This cannot be
  undone, so you are asked to confirm, and you must wait for a running reply to
  finish first. A message that is still streaming has no button yet; reopen the
  conversation from History to see it.
  **Needs:** your ClawAI backend, which stores the conversation.
- **Checkpoints**: **ClawAI: Create Checkpoint** remembers the current state of the
  files the agent changed. **ClawAI: Restore Checkpoint** puts them back, and can
  also rewind the conversation to the same moment. A restore goes through the
  normal preview and approval, so it can be undone too.

## Long conversations

When a conversation gets close to its limit, the **autoCompact** setting decides
what happens: do nothing, offer to summarize, or summarize automatically.
**ClawAI: Compact Conversation** does it on demand: it writes a summary and
continues in a new conversation. The original is kept in your history.

Related helpers: **ClawAI: Ask a Side Question** (answered outside the
conversation), **ClawAI: Session Recap**, **ClawAI: Show Usage**, and
**ClawAI: Select Output Style** (see [Extend it](extend-it.md)).
