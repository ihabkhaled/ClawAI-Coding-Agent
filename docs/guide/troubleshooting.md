# Troubleshooting

Start with the logs, then find your problem below.

## View the logs

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **ClawAI: Show Logs**. The **ClawAI** output panel opens.

Secrets, tokens and passwords are hidden in the logs, so it is safe to copy lines
into a support request. Remote runs and cloud sessions write to their own output
panels (**ClawAI Cloud Session**, **ClawAI Runner Session**).

To report a problem, run **ClawAI: Send Feedback**. It opens a short report about
your installation, such as versions, connection state and chosen modes, and sends
nothing until you read it and choose **Send to ClawAI**. It contains no prompts,
code or file paths.

## Sign-in problems

**The browser does not open, or you see "Sign-in was not completed".**

1. Choose **Connect to ClawAI** again. Each attempt has a two-minute limit, and a
   new click starts a fresh one.
2. Check the **Frontend** choice on the connection screen. It is the web address
   your browser opens. Cloud and Local are different places.
3. Make sure you approve VS Code on the ClawAI page, then return to the editor.

**"ClawAI could not verify this sign-in."** Go back to VS Code and start again. Do
not reuse an old sign-in tab.

**"Your ClawAI session expired. Reconnect to continue."** Run **ClawAI: Connect**.
If it keeps happening, run **ClawAI: Log Out** first, then connect again.

**A custom address is refused.** Use the app's origin, such as `https://example.com`.
Do not include a password, a token or extra query text. Any address other than
`localhost`, `127.0.0.1` and `claw.local` must use `https`.

## Model not available

- **"The selected model is not available."** Run **ClawAI: Refresh Models**, then
  pick a model again or choose **Automatic routing**. The model may have been
  removed, or your plan or organization may not include it.
- **Local models are missing.** The list says when Ollama or llama.cpp models could
  not be loaded. Refresh to retry, and check that the local service is running on
  the backend.
- **"The selected model cannot call tools, so an agent run will not edit files."**
  Choose a model that supports tools for agent work, or switch **Run** to **Chat**.
- **An image was not sent.** The model cannot read images. Choose one that can.
- **Requests stop working after a while.** You may have reached a usage limit. Run
  **ClawAI: Show Usage** to see your day, week and month totals.

## An approval is waiting

If a run seems stuck, it is often waiting for you.

1. Look for an **Approval required** card in the chat.
2. Open the **Needs You** view in the ClawAI sidebar. It lists every waiting
   approval or question, across all your chats.
3. Choose **Approve** or **Reject**. The run continues.
4. If you see "The approval no longer applies", the workspace or your rules changed
   while it waited. Grant it again, then resume.

Remote commands you did not answer within two minutes are refused automatically.
To avoid many prompts, raise the approval level in a folder you trust. See
[Chat and the agent](chat-and-agent.md).

## A run stopped by itself

- **"The run was stopped: it made the same ... call N times and nothing changed."**
  The agent was looping on one call. Start a new message with exact file paths and a
  concrete next step, or tell it what to do differently.
- **"The run stopped responding."** Nothing but heartbeats arrived for 10 minutes,
  even after one automatic reconnect. Send the task again; check **ClawAI: Show Logs**
  if it repeats. The first message is English in every language; the second is
  translated.

## The backend is unreachable

The message is "ClawAI backend is unavailable. Check the app address or start the
services, then retry."

1. Check the **Backend** address on the connection screen.
2. For **Local**, make sure your ClawAI stack is running and `https://claw.local`
   opens in your browser. Your computer must trust its certificate.
3. For **Cloud** or **Custom**, check your internet connection, VPN or proxy.
4. If requests time out, raise `clawAI.requestTimeoutMs`.
5. Retry, then check **ClawAI: Show Logs** for the error.

Brief outages are retried for you: reads up to 3 tries in 20 seconds, starting a run
or sending a tool result up to 8 tries in 120 seconds. You only see this message
after that allowance is spent.

## Other common problems

- **Nothing changes files.** The folder may be untrusted, or **Plan mode** is on, or
  the approval level is **Plan**. See
  [Running commands safely](running-commands-safely.md).
- **The agent cannot see a file.** Secret-looking files and anything excluded in
  `.clawai/ignore` or `clawAI.exclude` are never read. Check the **Context** view.
- **"Nearly out of room."** The conversation is close to its limit. Run **ClawAI:
  Compact Conversation**.
- **Attachments are refused.** Limits are 10 files, 25 MiB each and 50 MiB in total,
  and zero data retention refuses uploads.
- **"Not enough credit to transcribe ..." when reading audio or video.** Reading
  an audio or video file (SDK and CLI) is billed to your credit. Top up, or ask for
  a shorter clip; files over 15 MB are refused before any call. The read is never
  retried automatically, because a retry could bill you twice.
- **A message says "plan limit" instead of "rate limited".** You used up a plan or
  credit allowance. Another model hits the same plan limit; used-up credit may fall
  back to an included model. Wait for the reset or change plan.
- **Some models show `# Troubleshooting

Start with the logs, then find your problem below.

## View the logs

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **ClawAI: Show Logs**. The **ClawAI** output panel opens.

Secrets, tokens and passwords are hidden in the logs, so it is safe to copy lines
into a support request. Remote runs and cloud sessions write to their own output
panels (**ClawAI Cloud Session**, **ClawAI Runner Session**).

To report a problem, run **ClawAI: Send Feedback**. It opens a short report about
your installation, such as versions, connection state and chosen modes, and sends
nothing until you read it and choose **Send to ClawAI**. It contains no prompts,
code or file paths.

## Sign-in problems

**The browser does not open, or you see "Sign-in was not completed".**

1. Choose **Connect to ClawAI** again. Each attempt has a two-minute limit, and a
   new click starts a fresh one.
2. Check the **Frontend** choice on the connection screen. It is the web address
   your browser opens. Cloud and Local are different places.
3. Make sure you approve VS Code on the ClawAI page, then return to the editor.

**"ClawAI could not verify this sign-in."** Go back to VS Code and start again. Do
not reuse an old sign-in tab.

**"Your ClawAI session expired. Reconnect to continue."** Run **ClawAI: Connect**.
If it keeps happening, run **ClawAI: Log Out** first, then connect again.

**A custom address is refused.** Use the app's origin, such as `https://example.com`.
Do not include a password, a token or extra query text. Any address other than
`localhost`, `127.0.0.1` and `claw.local` must use `https`.

## Model not available

- **"The selected model is not available."** Run **ClawAI: Refresh Models**, then
  pick a model again or choose **Automatic routing**. The model may have been
  removed, or your plan or organization may not include it.
- **Local models are missing.** The list says when Ollama or llama.cpp models could
  not be loaded. Refresh to retry, and check that the local service is running on
  the backend.
- **"The selected model cannot call tools, so an agent run will not edit files."**
  Choose a model that supports tools for agent work, or switch **Run** to **Chat**.
- **An image was not sent.** The model cannot read images. Choose one that can.
- **Requests stop working after a while.** You may have reached a usage limit. Run
  **ClawAI: Show Usage** to see your day, week and month totals.

## An approval is waiting

If a run seems stuck, it is often waiting for you.

1. Look for an **Approval required** card in the chat.
2. Open the **Needs You** view in the ClawAI sidebar. It lists every waiting
   approval or question, across all your chats.
3. Choose **Approve** or **Reject**. The run continues.
4. If you see "The approval no longer applies", the workspace or your rules changed
   while it waited. Grant it again, then resume.

Remote commands you did not answer within two minutes are refused automatically.
To avoid many prompts, raise the approval level in a folder you trust. See
[Chat and the agent](chat-and-agent.md).

## A run stopped by itself

- **"The run was stopped: it made the same ... call N times and nothing changed."**
  The agent was looping on one call. Start a new message with exact file paths and a
  concrete next step, or tell it what to do differently.
- **"The run stopped responding."** Nothing but heartbeats arrived for 10 minutes,
  even after one automatic reconnect. Send the task again; check **ClawAI: Show Logs**
  if it repeats. The first message is English in every language; the second is
  translated.

## The backend is unreachable

The message is "ClawAI backend is unavailable. Check the app address or start the
services, then retry."

1. Check the **Backend** address on the connection screen.
2. For **Local**, make sure your ClawAI stack is running and `https://claw.local`
   opens in your browser. Your computer must trust its certificate.
3. For **Cloud** or **Custom**, check your internet connection, VPN or proxy.
4. If requests time out, raise `clawAI.requestTimeoutMs`.
5. Retry, then check **ClawAI: Show Logs** for the error.

Brief outages are retried for you: reads up to 3 tries in 20 seconds, starting a run
or sending a tool result up to 8 tries in 120 seconds. You only see this message
after that allowance is spent.

## Other common problems

- **Nothing changes files.** The folder may be untrusted, or **Plan mode** is on, or
  the approval level is **Plan**. See
  [Running commands safely](running-commands-safely.md).
- **The agent cannot see a file.** Secret-looking files and anything excluded in
  `.clawai/ignore` or `clawAI.exclude` are never read. Check the **Context** view.
- **"Nearly out of room."** The conversation is close to its limit. Run **ClawAI:
  Compact Conversation**.
- **Attachments are refused.** Limits are 10 files, 25 MiB each and 50 MiB in total,
  and zero data retention refuses uploads.
  marks or look dimmed in the picker.** The marks are a cost
  band (`# Troubleshooting

Start with the logs, then find your problem below.

## View the logs

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Run **ClawAI: Show Logs**. The **ClawAI** output panel opens.

Secrets, tokens and passwords are hidden in the logs, so it is safe to copy lines
into a support request. Remote runs and cloud sessions write to their own output
panels (**ClawAI Cloud Session**, **ClawAI Runner Session**).

To report a problem, run **ClawAI: Send Feedback**. It opens a short report about
your installation, such as versions, connection state and chosen modes, and sends
nothing until you read it and choose **Send to ClawAI**. It contains no prompts,
code or file paths.

## Sign-in problems

**The browser does not open, or you see "Sign-in was not completed".**

1. Choose **Connect to ClawAI** again. Each attempt has a two-minute limit, and a
   new click starts a fresh one.
2. Check the **Frontend** choice on the connection screen. It is the web address
   your browser opens. Cloud and Local are different places.
3. Make sure you approve VS Code on the ClawAI page, then return to the editor.

**"ClawAI could not verify this sign-in."** Go back to VS Code and start again. Do
not reuse an old sign-in tab.

**"Your ClawAI session expired. Reconnect to continue."** Run **ClawAI: Connect**.
If it keeps happening, run **ClawAI: Log Out** first, then connect again.

**A custom address is refused.** Use the app's origin, such as `https://example.com`.
Do not include a password, a token or extra query text. Any address other than
`localhost`, `127.0.0.1` and `claw.local` must use `https`.

## Model not available

- **"The selected model is not available."** Run **ClawAI: Refresh Models**, then
  pick a model again or choose **Automatic routing**. The model may have been
  removed, or your plan or organization may not include it.
- **Local models are missing.** The list says when Ollama or llama.cpp models could
  not be loaded. Refresh to retry, and check that the local service is running on
  the backend.
- **"The selected model cannot call tools, so an agent run will not edit files."**
  Choose a model that supports tools for agent work, or switch **Run** to **Chat**.
- **An image was not sent.** The model cannot read images. Choose one that can.
- **Requests stop working after a while.** You may have reached a usage limit. Run
  **ClawAI: Show Usage** to see your day, week and month totals.

## An approval is waiting

If a run seems stuck, it is often waiting for you.

1. Look for an **Approval required** card in the chat.
2. Open the **Needs You** view in the ClawAI sidebar. It lists every waiting
   approval or question, across all your chats.
3. Choose **Approve** or **Reject**. The run continues.
4. If you see "The approval no longer applies", the workspace or your rules changed
   while it waited. Grant it again, then resume.

Remote commands you did not answer within two minutes are refused automatically.
To avoid many prompts, raise the approval level in a folder you trust. See
[Chat and the agent](chat-and-agent.md).

## A run stopped by itself

- **"The run was stopped: it made the same ... call N times and nothing changed."**
  The agent was looping on one call. Start a new message with exact file paths and a
  concrete next step, or tell it what to do differently.
- **"The run stopped responding."** Nothing but heartbeats arrived for 10 minutes,
  even after one automatic reconnect. Send the task again; check **ClawAI: Show Logs**
  if it repeats. The first message is English in every language; the second is
  translated.

## The backend is unreachable

The message is "ClawAI backend is unavailable. Check the app address or start the
services, then retry."

1. Check the **Backend** address on the connection screen.
2. For **Local**, make sure your ClawAI stack is running and `https://claw.local`
   opens in your browser. Your computer must trust its certificate.
3. For **Cloud** or **Custom**, check your internet connection, VPN or proxy.
4. If requests time out, raise `clawAI.requestTimeoutMs`.
5. Retry, then check **ClawAI: Show Logs** for the error.

Brief outages are retried for you: reads up to 3 tries in 20 seconds, starting a run
or sending a tool result up to 8 tries in 120 seconds. You only see this message
after that allowance is spent.

## Other common problems

- **Nothing changes files.** The folder may be untrusted, or **Plan mode** is on, or
  the approval level is **Plan**. See
  [Running commands safely](running-commands-safely.md).
- **The agent cannot see a file.** Secret-looking files and anything excluded in
  `.clawai/ignore` or `clawAI.exclude` are never read. Check the **Context** view.
- **"Nearly out of room."** The conversation is close to its limit. Run **ClawAI:
  Compact Conversation**.
- **Attachments are refused.** Limits are 10 files, 25 MiB each and 50 MiB in total,
  and zero data retention refuses uploads.
  cheap to `$$` dearest, `0` free). A dimmed model is outside your free
  allowance but you can still pick it. No marks at all means the backend could not
  say, which is not an error.
- **Pull requests fail.** The GitHub tool `gh` must be installed and signed in.
- **A slash command does nothing.** It must be at the very start of the message, and
  its file must be in `.clawai/skills/` with a name of lowercase letters, digits and
  hyphens.

## Verified against

ClawAI Coding Agent 1.84.0 (package.json, package.nls.json and the source).
