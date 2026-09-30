# Getting started

This page takes you from install to your first finished agent task.

## What you need

- VS Code 1.98 or newer.
- A ClawAI account. You sign in through your browser, so your password never
  enters VS Code.
- A folder open in VS Code, and that folder marked as trusted.

## 1. Install

1. Open the Extensions view (`Ctrl+Shift+X`).
2. Search for **ClawAI Coding Agent** (publisher `clawai`) and choose **Install**.
3. A **ClawAI** icon appears in the Activity Bar. You can also press
   `Ctrl+Shift+A` to open the chat.

On a Mac, use `Cmd` where this guide says `Ctrl` (for example `Cmd+Shift+A`,
`Cmd+Enter`).

## 2. Sign in

1. Open the ClawAI chat. Before you are signed in you see a connection screen.
2. Choose where ClawAI lives. **Backend** and **Frontend** are separate choices:
   - **Cloud** is the hosted ClawAI service. Pick this for both if you use the
     hosted service.
   - **Local** is a ClawAI stack running on your own machine. It is selected
     when you first see the screen, so change it if you use the hosted service.
   - **Custom** lets you type another ClawAI address, for example your company's.
3. Choose **Connect to ClawAI**. Your browser opens on the ClawAI sign-in page.
4. Sign in there and approve VS Code. Return to the editor. The chat opens once
   sign-in succeeds.

Things to know:

- The whole sign-in has a two-minute limit. If it times out, choose **Connect**
  again to start fresh.
- Your session is kept in your operating system's secure credential store and is
  shared by all your VS Code windows.
- Local and Cloud keep separate sessions, so switching between them does not sign
  you out of the other one.

## 3. Finish the setup checklist

The **Getting Started** view in the ClawAI sidebar lists what is left, in order.
It disappears once everything is done and comes back if you sign out or close
the folder.

1. Connect to ClawAI.
2. Open a folder.
3. Trust the folder (VS Code asks; you can also use **Workspaces: Manage
   Workspace Trust**).
4. Load your models. This step is done as soon as ClawAI has a list of models for
   your account. Leaving **Automatic routing** selected is fine.

## 4. Your first chat

1. In the chat box, set **Run** to **Chat**.
2. Type a question, such as "Explain what this project does", and press
   `Ctrl+Enter` (or choose **Send**).
3. The answer streams in. Open the **Context** view in the sidebar to see exactly
   which files ClawAI looked at.

Tip: select some code in the editor and press `Ctrl+Shift+Enter` to ask about just
that selection.

## 5. Your first agent task

1. Set **Run** to **Agent**.
2. Open **More settings** and check that **Approval** is **Ask for Approval**.
   This is the safest choice and the default.
3. Ask for something small and concrete, for example: "Add a unit test for the
   `formatPrice` function."
4. Watch the progress in the chat. When the agent wants to change a file or run a
   command, an **Approval required** card appears. Read it, then choose **Approve**
   or **Reject**.
5. Look at the proposed changes. When the approval card offers **Review changes**,
   choose it to open them as normal VS Code diffs.
6. If you do not like the result, press `Ctrl+Alt+Z` (**ClawAI: Undo Last ClawAI
   Edit**). You can step back through the last twenty edits.

Tips for good tasks:

- Name the file or function, and say what "done" looks like ("all tests pass").
- Start with **Plan mode** for anything large. The agent writes a plan and changes
  nothing. See [Chat and the agent](chat-and-agent.md).
- To stop a run at any time, use the **Cancel run** button or `Ctrl+Alt+Escape`.

## Next steps

- [Chat and the agent](chat-and-agent.md): models, modes, approvals, rewind.
- [Files and attachments](files-and-attachments.md): point the agent at exactly
  the right code.
- [Troubleshooting](troubleshooting.md): if sign-in or models are not working.

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
