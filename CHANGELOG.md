# Changelog

What changed in each release of ClawAI Coding Agent, newest first. The full engineering log is in [docs/releases/DETAILED_CHANGELOG.md](docs/releases/DETAILED_CHANGELOG.md).

## 1.84.0

- Messages between agents now reach your other VS Code windows too.
- Continue a runner session from your editor, and hand a finished cloud session's result back into a chat.
- Pairing a phone shows a QR code you can scan.
- Plugin marketplaces can be signed; you choose whether unsigned plugins are refused.
- Command-line mode can resume a conversation, load MCP servers and set permission modes.
- Private (zero-retention) mode also blocks comparisons and hides thread titles.
- The download is about 11 MB smaller and starts faster.
- Thirteen security fixes, including safer artifact uploads, remote commands, plugin downloads and secret masking.
- Larger tap targets and full keyboard support for the new chat controls, checked in light, dark and right-to-left layouts.

## 1.83.0

- You can now let a long command return partial output early instead of blocking the whole turn.
- The agent now sees the browser screenshots it takes, when the model can read images.
- You can now publish an artifact and share it through a sandboxed public link.
- Organizations can now set guardrails on the server: rules, trusted lists, allowed and blocked MCP servers, and redaction of content after a turn or run ends.
- Added a Plugins view (plugin MCP servers and agents, git marketplaces, organization allowlist) and account and organization usage views.
- Routines can run on labelled runners with their own revocable tokens, and resuming a thread checks whether a run is still active. Needs an up-to-date ClawAI backend.

## 1.82.0

- Command-line exit codes changed: 0 ok, 1 failed, 2 usage, 3 auth, 4 denied, 5 budget, 130 aborted. The old 3 (blocked) is now 4 and the old 4 (cancelled) is now 130, so update any scripts that check them.
- You can now connect MCP servers (local or over HTTP, with sign-in). Every call asks first, and organizations can allow or block servers.
- You can now install plugins and use plugin marketplaces, and run the agent from your own code or the command line (`clawai -p`) with text, json or stream-json output.
- "Rewind to here" removes later turns, and checkpoints can restore your code, the conversation, or both.
- Added an optional sandboxed shell (docker, bubblewrap or seatbelt, network off by default), organization permission limits, a dependency audit and `/security-review`.
- You can now open pull requests with approval, get review from several reviewer agents, and fix failing checks with one click. Also new: remote triggers, device pairing, cloud routines and sessions, review comments on GitHub and GitLab, and Slack notifications. Needs an up-to-date ClawAI backend.

## 1.81.0

- You can now schedule tasks (**ClawAI: Manage Scheduled Tasks**) in trusted workspaces, and run saved workflows.
- The agent can work in its own session worktree, message its helper agents, and run commands in the background.
- The agent can run notebook cells through the Jupyter extension.
- You can prepare an artifact for publishing; it is scrubbed and re-checked for secrets first.
- The browser tool can click, type, scroll and take a screenshot.
- The composer lets you reorder attachments, shrinks oversized images, and supports voice dictation and more audio formats. You can also move the chat to the secondary side bar.

## 1.80.0

- The agent can now read PDFs, a few pages at a time. A scanned PDF is reported as scanned instead of as empty.
- Fixed undo history growing in memory over time.

## 1.79.0

- Checked that 21 settings really change behaviour, including that a custom backend setting redirects requests and that malformed hooks are refused. No change to how you use the extension.

## 1.78.0

- Twelve more agent tools were checked in a real editor. No change to how you use the extension.

## 1.77.0

- Fixed: attaching a file no longer costs you the agent and its tools. The file and the agent now arrive together.
- A failed run no longer leaves an orphan upload behind.

## 1.76.0

- Confirmed that the agent can search the web and read a page in a live run.
- Fixed: a web page longer than 65,536 characters ended the run. It is now cut, with a notice the model can act on.

## 1.75.0

- Internal testing fix: test runs no longer count a restarting backend as a model failure. No change to the extension.

## 1.79.0

Minor: every setting is proven to be consumed, not merely contributed.

- **Twenty-one settings written into a real editor and read back** through the
  extension. The inventory said "schema and read path verified; behaviour not
  exercised" for all of them, which is the honest description of a manifest
  entry: it proves a default exists and says nothing about whether anything
  reads the value. A setting that is contributed, documented and never read
  looks identical in the manifest to one that works.
- `backendEnvironment: CUSTOM` is asserted to actually redirect `backendUrl`.
  It is the one setting a user can get wrong and go on silently talking to the
  wrong host.
- Hooks are asserted to be **parsed**, not stored: a valid lifecycle hook
  survives and a malformed one is refused before it can reach the run loop.
- Each setting is written at the scope it declares. The connection settings are
  `machine` scope and VS Code refuses to write them into a workspace at all —
  which is the right call, since a repository must not be able to point a
  user's agent at a different backend by committing a settings file.
- Inventory: 97 of 116 rows PASS, 17 NOT RUN, up from 65 PASS a few releases
  ago.

## 1.78.0

Minor: twelve runtime tools proven reachable in a real editor.

- **Twelve of the twenty-six NOT RUN tools now answer for real** in the
  extension-host lane: planning, journal, workflows, services, quality,
  intelligence, goal, scan, notebook and database. Each had a unit test, which
  proves the code does what it was written to do and says nothing about
  whether the tool is registered, reachable, or given a target it recognises.
- An empty answer is the expected answer in a fresh workspace, so what these
  assert is that a tool answers **in its own shape** — naming the collection it
  owns — rather than refusing or failing to be registered.
- Two refusals are asserted as behaviour, not accidents: `workspace.scan`
  refuses a missing SARIF file _with a reason an agent can act on_, and
  `workspace.database` refuses a workspace target because it does not own one.
- **`runtime.board` is recorded BLOCKED, not failing.** It is registered only
  for sub-agents and is unreachable from an ordinary run by design — the
  inventory said NOT RUN, which read like an omission.

## 1.77.0

Minor: attaching a file no longer costs you the agent.

- **Any request carrying an attachment was routed down the legacy chat path.**
  Runtime V2 had no carrier for files, so the extension fell back — silently,
  and with the agent's tools left behind. Asking _about_ a file worked; asking
  the agent to _do_ something with it quietly got a weaker system.
- The run start now carries `fileIds`, so the file and the agent arrive
  together. Research mode still forces the legacy path; it has no carrier yet.
- The upload is a transaction: acquired before the run, accepted only once the
  run settles without throwing, rolled back otherwise, so a failed run leaves
  no orphan upload.
- A run with no attachment sends no `fileIds` at all rather than an empty
  array, which would make every ordinary run look like one that had
  attachments and lost them.

## 1.76.0

Minor: the agent researches the web for real, and a long page no longer kills
the run that fetched it.

- **`workspace.web` proven live.** In a round the agent searched, found the
  official VS Code documentation URL, fetched the page and listed three
  activation events from it. Search and fetch both go through the research
  service, which holds the provider credentials.
- **A page over 65,536 characters killed the run.** The Runtime V2 JSON
  contract caps any single string at that length, and the fetched page was
  passed through unbounded — so the backend refused the tool result with
  `400 Validation failed` and the run died with nothing naming the field. The
  filesystem read was fixed for this same contract; the web fetch never was.
- The page is now cut rather than refused, with a notice the model can act on
  and a `truncated` flag. Cutting silently would be worse than failing: the
  model reads a truncated page as the whole page and answers confidently about
  content that was never there.

## 1.75.0

Patch in effect, minor by rule 5: rounds stop blaming models for the stack.

- **A restarting backend is no longer a result.** The dev stack rebuilds on
  every source change and serves 502 while it does; rounds recorded those as
  model failures, and one sweep lost fifteen that way. The runner waits for the
  backend before starting and retries a round that hit a 5xx.
- The readiness probe asks `/chat-threads`, not `/health`. That path is served
  by a different service, so it answered 200 while chat-service was still
  rebuilding and the wait returned straight into another 502. A 401 is the
  right answer — it proves the service is up and refusing an unauthenticated
  call.
- Rounds can take several turns in one thread, and a turn can ask for a fresh
  thread, which is what separates remembering a conversation from remembering
  a different one.

## 1.74.0

- Every release now publishes automatically to the VS Code Marketplace and Open VSX.
- The agent remembers earlier turns of a conversation, including long ones. Known gap: it does not yet reliably recall a fact from a different conversation.

## 1.73.0

- Internal testing: the same ten coding tasks now run against every tool-capable model after each release. No change to the extension.

## 1.72.0

- Fixed: an agent's edit could leave the file on disk unchanged while the editor showed the new text. Edits are now saved as part of the change.
- Fixed: `git status` now lists every new file, unstaging works in a repository with no commits yet, and the staged-secret check now recognizes OpenAI and Anthropic keys.

## 1.71.0

- Internal toolchain upgrade and faster tests. No change to the extension.

## 1.70.0

- A finished tool call now says what it did (a command's exit status, how many files were found, why something was refused) instead of only bytes and time.

## 1.69.0

- Fixed: the panel never narrated progress between tool calls. It now shows "Thinking" and the model's own summary.
- A message you type mid-run is confirmed as taken into account, or refused with the reason.

## 1.68.0

- Each line in the tool trail now names its subject: the file read, the command run, the query searched or the address opened.
- A multi-file edit says how many more files it touches.

## 1.67.0

- The agent's conversations no longer appear in your normal chat list. The web app shows them read-only.

## 1.66.0

- All 11 keyboard shortcuts were checked in a real editor. No change to how you use the extension.

## 1.65.0

- 42 of the 43 commands were run from the palette in a real editor and reported no failure. No change to how you use the extension.

## 1.64.0

- Fixed release packaging: the published extension no longer includes the repository's git hook files.

## 1.63.0

- All eight side views were checked to show real content, and each explains why it is empty while you are not connected.

## 1.62.0

- Checked the first run before you connect: the status bar names the backend and connection state, and the setup view names the next step, including trusting the workspace.
- Commands are now run from the palette in testing, not only listed.

## 1.61.0

- Checked that pressing Connect starts a real sign-in flow and that the panel stays usable afterwards.

## 1.60.0

- The chat panel is now tested inside a real editor: onboarding shows the local address and all three backends, and the Connect button works.

## 1.59.0

- Added a test lane that installs the packaged extension into a real editor and checks that all nine views, the commands and the chat panel load.

## 1.58.0

- Fixed the release process: version assets were missing, so releases were not publishing. No change to the extension.

## 1.57.0

- Every command, shortcut, menu entry and view was checked to work, and every title is translated rather than English.

## 1.56.0

- Internal: live checks default to the Ollama connector, so running them costs no paid credit.

## 1.55.0

- Internal: the live check now accepts the multi-file edit format the product uses, removing a wasted tool call per run.

## 1.54.1

- Internal test fix. No change to the extension.

## 1.54.0

- Every setting was checked: it is actually used, its default matches its type, and it has a description and a bound where numeric.

## 1.53.0

- Added tests for the browser, elevation and process tools, confirming they refuse malformed or misaddressed requests.

## 1.52.0

- Added tests for four more tools (database, services, evidence, quality), confirming they refuse misaddressed requests.

## 1.51.0

- Added tests for twelve tools, confirming each refuses a request meant for another tool.

## 1.50.0

- Fixed: a failed tool call was not logged, and creating a file with no path failed with a confusing directory error.
- The error now names the arguments it received, so the model can correct itself on the next call.

## 1.49.0

- Added tests for the Git tool, which refuses to let an argument change the operation being run.

## 1.48.1

- Documentation only: recorded what the installed-extension checks prove about commands.

## 1.48.0

- Added a generated list of every command, setting, view, shortcut and tool with its test status. No change to how you use the extension.

## 1.47.0

- The browser sign-in return page now removes the sign-in code from the address, offers an **Open Chat** button, and shows a plain close instruction when the browser will not close the tab. Available in all 13 languages.

## 1.46.0

- Added an agent SDK (`runAgent`) so other programs can run the agent with their own tools. A failing tool returns a failed result rather than ending the run.

## 1.45.0

- Headless runs no longer pass their own credentials to commands the model runs.
- Headless runs may only run node, npm and npx by default; `--allow-command <name>` allows more.
- Fixed: in headless runs, a symbolic link inside the workspace could be used to read or write outside it. This is now refused.

## 1.44.0

- Added headless mode: `npm run headless -- --prompt "<task>"` runs the agent with no editor and no prompts.
- Exit codes say what happened: 0 completed, 1 failed, 2 unusable, 3 blocked, 4 cancelled, 5 ran out of time or budget.

## 1.43.0

- A flagship delivery can now use any strategy name instead of one of five fixed names.

## 1.42.0

- Added `npm run check:live`, which proves the agent can actually code by running a real task and checking the result.

## 1.41.0

- Fixed: a command that refused to stop could hang the run. Commands are now stopped firmly, including their child processes on Windows.
- The result says whether a process had to be killed.

## 1.40.0

- The agent can now check whether a branch is ready for a pull request and list the blockers in the order to fix them.

## 1.39.0

- Cached prompt tokens are now counted as cached in the token meter, so a cheap conversation no longer looks expensive.

## 1.38.0

- You can now send run traces to your own collector with the `clawAI.telemetryEndpoint` setting. It is off unless you set it, and secrets are removed before sending.

## 1.37.0

- The agent can now import a security scanner report and record its results as findings.

## 1.36.0

- You can now drag files from the editor or explorer into the composer. Hold Shift to insert the path instead of the file contents. Files outside the open folder are refused.

## 1.35.0

- The diagnostic report now says exactly what isolation your machine can give commands, including "none".

## 1.34.0

- The agent can now save a set of agents as a workflow in `.clawai/workflows` and run it again later.

## 1.33.0

- The agent can now set goals with acceptance checks for a run, and cannot finish while a check is still open.

## 1.32.0

- Agents working together can now leave notes for each other on a shared board.

## 1.31.0

- Helper agents can now inherit what the main agent already knows, so they do not repeat its work. Off by default.

## 1.30.0

- The agent can now wait for a file to appear, change, disappear or match a pattern, with a time limit.

## 1.29.0

- You can now add your own sites, such as a dev server, to the browser tool with the `clawAI.browserOrigins` setting.

## 1.28.0

- The agent can now ask a different model for a second opinion, without giving it your files.

## 1.27.0

- Added **ClawAI: Toggle Fast Mode** for quicker replies.

## 1.26.0

- References to a line range are now marked as changed or gone when you save the file.

## 1.25.0

- Added automatic conversation summarizing with the `clawAI.autoCompact` setting. It offers by default.

## 1.24.0

- You can now choose from seven routing strategies, including local models only, privacy first, fastest, strongest and lowest cost.
- The panel warns when the selected model cannot use tools.

## 1.23.0

- Search can now match across line breaks and be limited to file types such as `ts`.

## 1.22.0

- Added a **Needs You** view with a badge that lists runs waiting for your approval or answer.

## 1.21.0

- Added **ClawAI: Open Run Terminal**, where you type a request and the run reports back like a build log.

## 1.20.0

- The model's private reasoning text stays on your machine. The panel shows only how many steps and how large.

## 1.19.0

- A project policy can now refuse or require approval for requests to certain hosts.

## 1.18.0

- Added **ClawAI: Create Checkpoint** and **Restore Checkpoint** for files the agent changed. A restore is previewed, approved and can be undone.

## 1.17.0

- Added **ClawAI: Ask a Side Question**. The answer opens as a document and stays out of your conversation and history.

## 1.16.0

- The agent can now edit a single notebook cell without rewriting the whole notebook. Outputs and metadata are kept.

## 1.15.0

- Added **ClawAI: Attach Terminal Output** to put a terminal's last command and its output in the composer.
- Security fix: secrets such as `GITHUB_TOKEN=...` are now hidden in logs, diagnostics and feedback reports.

## 1.14.0

- Added **ClawAI: Group Conversation** to organize conversations into groups, shown as folders in History.

## 1.13.0

- Added **ClawAI: Open Conversation in New Window**.

## 1.12.0

- Added **ClawAI: Compact Conversation**, which summarizes a long conversation and continues in a new one. The original is kept.

## 1.11.0

- The composer now warns before you send that the model is nearly out of room, keeping space for its reply.

## 1.10.0

- Location and device details are removed from photos you attach, before upload.
- Images are not sent to models that cannot see them, and each request has an image budget.

## 1.9.0

- You can now run your own commands at the start and end of a run and before or after a tool with `clawAI.hooks`.

## 1.8.0

- Added **ClawAI: Select Output Style** (default, concise, explanatory, learning). Projects can define their own in `.clawai/output-styles`.

## 1.7.1

- Fixed: new translations replaced some existing ones (for example in Chinese and Thai).

## 1.7.0

- Your skill files are now slash commands: `.clawai/skills/review.md` becomes `/review`, with arguments.

## 1.6.0

- Twenty commonly used strings were translated, and new text must now be translated before it can ship.

## 1.5.0

- The status line now shows what the agent is doing and which model the next prompt will use.
- Nine more commands have keyboard shortcuts, including stopping a run.

## 1.4.0

- You can now move between turns of a conversation with Alt+Up and Alt+Down, and each turn is labelled for screen readers.

## 1.3.0

- Added a Getting Started checklist (sign in, open a folder, trust it, load models) that hides itself when done.

## 1.2.0

- The agent can now search the web and read a page during a run.

## 1.1.0

- Added **ClawAI: Toggle Focus View** to hide the side panels and keep only the conversation and composer.

## 1.0.0

- You can now rename, archive and restore conversations, and pinned conversations sort first.

## Earlier versions

Versions 0.1.0 to 0.99.0 built the extension up to 1.0.0. Highlights: secure browser sign-in (0.1), Agent mode with reviewed edit previews (0.3), separate editor-tab chats (0.6), attachments (0.9), online research (0.12), external output folders (0.16), clearer failure messages, working file writes and command running (0.47 to 0.61), parallel helper agents, flagship deliveries that survive interruption (0.63), workspace search, the Problems panel and language-server questions (0.66 to 0.70), organization limits, and notifications (0.81 to 0.87), and chat tab markers and `@` mentions (0.98 to 0.99). Full details are in [docs/releases/DETAILED_CHANGELOG.md](docs/releases/DETAILED_CHANGELOG.md).
