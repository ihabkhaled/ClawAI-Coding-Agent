# UX

What this answers: design system, UX decisions, accessibility.

Part of the [project wiki](../index.md). One canonical home per fact -
link to it, never copy it. Current truth, history and future intent are
kept apart and labelled.

Written 2026-11-28 for extension version 1.116.0. Counts come from `package.json` on that date.
Message texts are quoted from the user guide, which says it was verified against 1.84.0, so wording may have moved.

## Is there a design system, which UX decisions are settled, and which accessibility standard applies?

- **Design system.** There is no stand-alone design-system document. The working system is [UX_GUIDELINES](../../UX_GUIDELINES.md):
  "a quiet VS Code-native flight deck, not a replica of a consumer chat page". The panel uses VS Code theme variables, plain
  HTML and CSS (`media/chat.css`, `media/chat.js`, no framework). Whether that counts as the owner's design system is an open question.
- **Settled decisions.** The table "UX decisions and their reasons" below. Each row names its source.
- **Accessibility standard.** No named standard (for example a WCAG level) is recorded. What is recorded is a list of practices and
  automated checks, in the accessibility section below.

## Principles

From [UX_GUIDELINES](../../UX_GUIDELINES.md):

- Use VS Code theme variables; keep contrast in light, dark and high-contrast themes.
- Keep AUTO or manual route, and provider and model, explicit.
- Make busy, disconnected, error, quota and cancellation states visible.
- Show context receipts and edit previews before asking the user to trust an operation.
- Keep destructive or modifying choices modal and explicit.
- Keep focus outlines, landmarks, labels, live regions and a skip link.
- Support keyboard-only use, narrow sidebars, zoom and right-to-left layouts.
- Render untrusted strings as text, never as HTML.

## Panel layout

One Activity Bar container, **ClawAI**, holds ten views ([webview page](../features/webview-views-commands.md)):

| View            | Shown                     | Purpose                                                                                      |
| --------------- | ------------------------- | -------------------------------------------------------------------------------------------- |
| Chat            | always (a webview)        | The conversation, composer and run timeline                                                  |
| Getting Started | while setup is incomplete | Checklist: connect, open a folder, trust it, load models                                     |
| Model & Route   | always                    | The AUTO Router and each model you can use, marked local or connected and active             |
| Context         | always                    | Files included, left out or shortened                                                        |
| History         | always                    | Saved conversations: rename, archive, pin, group, search                                     |
| Needs You       | always                    | Waiting approvals and questions, plus runs that failed, are slow or are queued, across chats |
| Tasks           | always                    | The run's task list, one task in progress                                                    |
| Findings        | always                    | Problems found by reviews, security checks and scanners, worst first                         |
| Delivered Files | always                    | Files the agent made                                                                         |
| Plugins         | always                    | Plugins, with a signed or unsigned badge                                                     |

The chat panel itself:

- **Route rail.** Keeps backend, route, context, token and plan provenance visible. At narrow widths it collapses but never hides the
  active route summary. Details stay one compact line until expanded (checked in [UAT](../../UAT.md)).
- **Composer.** Controls: Run (Agent, Chat, Compare, Compare + Judge), Context, Web research, Effort, Speed, and Approval under **More settings**.
  Since 1.88.0 the box remembers Run, Context and Web research across reloads. Up and Down arrows recall earlier prompts.
- **Compare tray.** Shown only in Compare or Compare + Judge. It enforces two to five models. Each model gets a card the moment it starts
  (Connecting, Thinking, Writing, Finishing), then a judge verdict with winner, ranks, scores and reasons (1.90.0).
- **Tabs.** Several chats in editor tabs, with markers for running, awaiting approval, failed and unread. Two can run at once.
- **Status bar.** Backend, connection state, what the agent is doing, queue depth and the model the next prompt will use. A pending question
  outranks running work.
- **Focus view** (`clawAI.viewDensity`, Ctrl+Alt+F). Hides the runtime timeline, compare tray and run deck. The toggle stays in the composer rail.
- **Other homes.** `@clawai` in VS Code's own Chat view; a command to move the panel to the secondary side bar; `vscode://` deep links
  that open the view or one conversation, never sign in ([ADR 0001](../../adr/0001-uri-handler-navigation-only.md)).

## Commands, shortcuts and settings

The extension contributes 69 commands, 38 settings, 11 keybindings, 10 views and 1 walkthrough. Every command starts with "ClawAI:" in the palette.

| Shortcut (Windows and Linux) | Command               |
| ---------------------------- | --------------------- |
| Ctrl+Shift+A                 | Open Chat             |
| Ctrl+Shift+Enter             | Ask About Selection   |
| Ctrl+Alt+M                   | Select Model          |
| Ctrl+Alt+R                   | Review Selected Code  |
| Ctrl+Alt+U                   | Generate Tests        |
| Ctrl+Alt+X                   | Fix Selected Code     |
| Ctrl+Alt+Escape              | Cancel Active Request |
| Ctrl+Alt+Z                   | Undo Last ClawAI Edit |
| Ctrl+Alt+H                   | Search Run History    |
| Ctrl+Alt+T                   | Reopen Closed Chat    |
| Ctrl+Alt+F                   | Toggle Focus View     |

On macOS use Cmd instead of Ctrl. Right-click menus offer Ask, Fix and Review on a selection and Ask About File in the Explorer.
Full list: [README](../../../README.md#commands-and-shortcuts). Settings are in the [settings guide](../../guide/settings.md).

## First run

1. **Gateway.** Before sign-in the panel shows only the product name, the backend origin, **Connect to ClawAI**, progress or error text, and a short
   security note. History, models, context and the composer are not shown as available. Errors stay inside the panel, not in dialogs.
2. **Pick a server.** Backend and Frontend are separate choices: Local (`https://claw.local`), Cloud (`https://claw-ai.co`) or Custom.
   Local is preselected. The two-minute sign-in limit and the browser step are in [accounts](../features/accounts-and-sign-in.md).
3. **Getting Started view.** Four steps; it disappears when done and returns after sign-out or closing the folder.
4. **Walkthrough.** Seven steps, from `media/walkthrough/`: connect, ask, run an agent task, attach files and voice, review and rewind,
   commit and open a pull request, discover skills, plugins, MCP and scheduled tasks.

## Approvals

- **Five levels** under More settings: Plan, Ask for Approval (default), Auto Edit, Autonomous Scoped, Strict. See [permission modes](../features/permission-modes-approvals.md).
- **Approval card.** "Approval required" appears in the chat, a notice says ClawAI is waiting, and the Needs You view lists it. Buttons: Approve and Reject.
  The first routine request is titled "Enable routine workspace access" and the button reads **Always allow in this workspace**.
- **Review before apply.** "Review changes" opens normal VS Code diffs. The right pane is an editable draft. A review that goes stale needs a new one.
- **Strict reading of "yes".** Only a real yes approves; anything else counts as no (1.92.0). A deny rule always wins.
- **Stop and undo.** Cancel button or Ctrl+Alt+Escape. Undo up to twenty edits. **Rewind to here** and checkpoints for bigger steps, each with a confirmation.
- **Timeouts.** Remote commands with no answer in two minutes are refused.
- **Mid-run messages** are queued, and confirmed or refused with the reason (1.69.0).

## What users see on errors and limits

| Situation                                                 | What the user sees                                                                                                   | What helps                                                                                     |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Not signed in, or session expired                         | Gateway; "Your ClawAI session expired. Reconnect to continue."                                                       | **ClawAI: Connect**, or Log Out then Connect                                                   |
| Sign-in fails or times out                                | "Sign-in was not completed"; "ClawAI could not verify this sign-in."                                                 | Click Connect again for a fresh attempt; check the Frontend choice                             |
| Backend unreachable                                       | "ClawAI backend is unavailable. Check the app address or start the services, then retry."                            | Shown only after retries: reads 3 tries in 20 s, run start and tool results 8 tries in 120 s   |
| Model not available, cannot call tools, cannot see images | "The selected model is not available."; "The selected model cannot call tools, so an agent run will not edit files." | **ClawAI: Refresh Models**, pick another, or switch Run to Chat                                |
| Plan limit                                                | A plan-limit message, not "rate limited"; it stops at once and does not switch model (1.110.0)                       | **ClawAI: Show Usage**; wait for reset or change plan                                          |
| Credit spent                                              | "Credit used up on A, continuing on B" when a fallback model is listed; otherwise the original error                 | Add models to `clawAI.fallbackModels`; top up your credit (the extension has no top-up screen) |
| Billed audio or video read                                | "Not enough credit to transcribe ..."; a 402 says nothing was billed; files over 15 MB are refused first             | Top up or use a shorter clip                                                                   |
| Waiting on an approval                                    | "Approval required" card; "The approval no longer applies" if rules changed                                          | Needs You view; grant again                                                                    |
| Run loops                                                 | "The run was stopped: it made the same ... call N times and nothing changed."                                        | New message with exact paths                                                                   |
| Run goes silent                                           | "The run stopped responding" after 10 silent minutes, one reconnect, then 10 more                                    | Send the task again; Show Logs                                                                 |
| Conversation nearly full                                  | A "Context nearly full" card: **Summarize and continue** or **Not now**                                              | **ClawAI: Compact Conversation**                                                               |
| Attachment refused                                        | Limits 10 files, 25 MiB each, 50 MiB total; zero retention refuses uploads                                           | Remove or shrink                                                                               |
| Untrusted folder or Plan mode                             | The agent only chats and reviews                                                                                     | Trust the folder; leave Plan                                                                   |
| Dictation unavailable                                     | A notice naming what works: Win+H, Fn twice, or the VS Code Speech extension                                         | Use the tip                                                                                    |

Log help: **ClawAI: Show Logs** (secrets masked). Report a problem with **ClawAI: Send Feedback**, which shows the report first. Source: [troubleshooting](../../guide/troubleshooting.md).

## Accessibility

Practices recorded in the docs ([localization and accessibility](../features/localization-accessibility.md)):

- Keyboard: Alt+Up and Alt+Down step between turns and stop at each end instead of wrapping. Each turn is a labelled, focusable article.
- Screen reader: live regions announce changes. Compare cards announce phase changes without reading the answer word by word.
- Focus never leaves the prompt box during a compare run; a skip link, landmarks, labels and focus outlines exist.
- Themes: light, dark and high contrast. Layout: narrow sidebar, 200% zoom and right-to-left (Arabic and Persian) are on the UAT checklist.
- Automated checks: the device matrix runs eight viewports (320, 400, 768 and 1280 wide, portrait and landscape) in left-to-right and right-to-left,
  dark and light, asserting no overflow, reachable targets and contrast of at least 4.5. Compare cards are checked at 320, 400 and 768.
- Not recorded: a test with a real screen reader, a WCAG target.

## Languages

- 13 locale bundles: English plus 12 translations: ar, de, es, fa, fr, hi, it, ja, pt, ru, th, zh. "12 locales" means the translations;
  "13-locale" counts English. Both describe the same set ([RULES](../../RULES.md) rule 11).
- Every visible string goes through `vscode.l10n.t` or `package.nls.json`; `npm run l10n:build` regenerates the files; `npm run l10n:verify` and a coverage test gate it.
- `l10n/untranslated-baseline.json` holds 307 entries and may only shrink.
- Known English-only messages: the repeat-stop message and the headless plan or credit message.
- A brand name that is the same in all locales must be a plain constant, not a translated string.

## UX decisions and their reasons

| Decision                                                                                    | Reason as recorded                                                                                       | Source                                                                       |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Disconnected state is a gateway, not a disabled workbench                                   | Reason not recorded; the gateway lists only identity, origin, Connect and a security note                | [UX_GUIDELINES](../../UX_GUIDELINES.md)                                      |
| Turn navigation stops at the ends                                                           | Wrapping "teleports a reader from the newest message to the oldest"                                      | Audit F070                                                                   |
| Focus-view toggle stays in the composer rail                                                | "A mode you cannot leave is not a mode"                                                                  | Audit F068                                                                   |
| Compaction offer is an inline card, not a dialog                                            | A dialog would block the editor (1.102.0)                                                                | [chat page](../features/chat-and-streaming.md)                               |
| Needs You badge counts approvals, questions and failures only                               | Counts "not busy time"; a fuller reason is not recorded                                                  | Audit F102                                                                   |
| "Enterprise Locked" shown as Strict                                                         | The old name "advertised an organizational lock that did not exist"                                      | [ADR 0003](../../adr/0003-permission-modes-under-an-organization-ceiling.md) |
| Approval choices must do what their names say (Strict asks every time; Plan can still read) | Reason not recorded beyond the release title "approval choices do what their names say" (1.88.0, 1.89.0) | [permission page](../features/permission-modes-approvals.md)                 |
| Plan or credit limit stops at once                                                          | Another try or another model cannot help (1.110.0)                                                       | `src/core/retry-classifier.constants.ts` comment                             |
| Cost marks are a hint; a dimmed model is still selectable                                   | "The send path stays the gate" (1.111.0)                                                                 | [models page](../features/models-routing-compare.md)                         |
| Dictation button explains itself when unavailable                                           | "Silence would read as a dead button"                                                                    | [voice page](../features/voice-dictation.md)                                 |
| Silence or a user stop in dictation is not an error                                         | It "would teach people that the feature is broken when it is not"                                        | Same page                                                                    |
| Groups of chats are client-side only                                                        | A group that looked shared would be wrong on another device (F062)                                       | [chat page](../features/chat-and-streaming.md)                               |
| Private reasoning text never reaches the webview                                            | A leak found in the F043 audit (1.20.0)                                                                  | Same page                                                                    |
| Sign-in return page promises no tab close; it removes OAuth data from the address           | Honest return action                                                                                     | [RULES](../../RULES.md) rule 4                                               |
| Engine floor stays `^1.98`; a move command ships instead of a native secondary side bar     | Raising the floor drops older VS Code users; a release-owner decision (F067)                             | [PARTIAL_REMAINDERS](../../parity/PARTIAL_REMAINDERS.md)                     |
| Connection settings are machine scope                                                       | A repository must not point the agent at another backend                                                 | [settings guide](../../guide/settings.md)                                    |

## Known gaps

- No warning before a limit is reached: the 2026-08-07 status doc lists thresholds as gap E7. The user learns of a limit when it stops a request, or by opening Show Usage.
- Whether Show Usage shows the exact reset time of each window is not recorded (gap E4).
- 70 of 170 surface rows are NOT RUN in the [surface inventory](../../parity/SURFACE_INVENTORY.md).
- 307 strings still untranslated; some runtime messages are English only.
- The user guide pages say "verified against 1.84.0". `docs/guide/troubleshooting.md` holds its body three times (331 lines), so edit it with care.

## Open questions

Is [UX_GUIDELINES](../../UX_GUIDELINES.md) the design system, or does the owner want a separate one?
_Unknown - ask the owner and record the answer._

Which accessibility standard is the target (for example WCAG 2.2 AA), and has anyone tested with a real screen reader?
_Unknown - ask the owner and record the answer._

Who reviews translation quality, and which languages come next?
_Unknown - ask the owner and record the answer._

Why is the gateway a gateway and not a disabled workbench?
_Unknown - ask the owner and record the answer._

Should the panel warn before a plan limit or low credit, and at what thresholds?
_Unknown - ask the owner and record the answer._

Should the engine floor rise to `^1.106` to allow a native secondary side bar?
_Unknown - ask the owner and record the answer._
