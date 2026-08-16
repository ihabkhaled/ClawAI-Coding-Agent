# Changelog

All notable changes to ClawAI Coding Agent are documented here.

## 0.61.10

Patch: 0.61.9 only removed the duplicate box-shadow from the composer's focus ring; the border-color change to `--vscode-focusBorder` was still there and still read as an unwanted blue outline around the whole composer, hint line included. `.composer-card:focus-within` in `media/chat.css` is removed — the composer now keeps its normal border on focus, no color change at all.

## 0.61.9

Patch: two panel-styling fixes.

- The composer's focus state stacked a solid `--vscode-focusBorder` border and a duplicate 1px box-shadow ring of the same color, doubling the visual weight of the outline every time the prompt textarea was focused. `.composer-card:focus-within` in `media/chat.css` now changes only the border color, matching the single-weight focus treatment every other focusable control in the panel already uses.
- The status strip (`.agent-status`) and run deck (`.run-deck`) at the top of the panel carried the same padding used for content-heavy areas, so the header consistently ate a large share of the panel before any conversation was visible. Both now use tighter vertical padding/gap.

## 0.61.8

Patch: the chat panel's per-message activity list (`workspace.files · read`, `workspace.command · run`, etc.) never scrolled as new entries streamed in. A message bubble scrolled into view once when it was first created, but every activity item appended into it afterward — often dozens per run — left the viewport wherever it happened to be, so watching a live run meant manually scrolling down after every few tool calls.

- `appendActivity()` in `media/chat.js` now scrolls each new item into view as it's added, the same way a new message bubble already did. Both call sites that feed it — `publishRunActivity()` (phase/file/command activity) and `appendStreamActivity()` (reasoning and stream events) — get this for free since they both go through the one function.

## 0.61.7

Patch: a `runtime.agents` graph's status and outcome events — including the full `blocker` text 0.61.5 started reporting — went to a coordinator observer that was wired as a no-op (`{ status: () => undefined, outcome: () => undefined }`). Nothing about a sub-agent's progress or failure reason was ever written anywhere durable; the only copy of a `blocker` string existed in the tool-result JSON handed back through the chat backend, which independently clips any persisted tool-result content to 400 characters. For a graph that failed with a longer blocker, the real reason was unrecoverable from any source once that message was written.

- `VscodeSubAgentDiagnosticsSink` implements `SubAgentCoordinatorObserver` and appends one JSON line per status change and per outcome to `<globalStorage>/sub-agent-diagnostics.log`, alongside logging the same untruncated content through the existing `OutputLogger`. `VscodeRuntimeStudio` now wires this sink instead of the no-op observer. Best-effort: a write failure is reported to the logger, never thrown, so a diagnostics-log problem can't fail a real sub-agent run.
- Covered with a unit test asserting a 2,000-character blocker round-trips intact through the log file, and a second test asserting a write failure onto an unwritable path is reported to the logger rather than thrown.

## 0.61.6

Patch: a `runtime.agents` task that failed or was cancelled leaked its worktree forever, so retrying the same graph always failed immediately with "Sub-agent worktree is already active".

- `VscodeSubAgentWorktreeAdapter` tracks one active worktree per `worktreeId` and only releases it via `abandon()`. `SubAgentCoordinatorService.start()` called `abandon()` on every path where `prepare()`/`execute()` threw an exception, but a sub-agent that ends with `run.failed` returns its outcome normally rather than throwing — that path went straight to `finish()`, which only releases the file lease, never the worktree. A succeeded task's worktree is correctly left alive on purpose (its commit waits there for a later `runtime.integration` call to cherry-pick it onto the target branch), which is exactly why this one case was never exercised before. Hit live: after fixing the git worktree path-length bug, batch-02 failed in-band once, and every following attempt at the same 2-task graph failed immediately for both tasks with the "already active" error, reported correctly by 0.61.5's more honest failure messages.
- `settleWorkspace()` now abandons the worktree whenever the outcome isn't `succeeded`, matching the coordinator's existing rule for the two thrown-exception paths. Covered directly: a coordinator test with a mocked workspace port asserting `abandon()` is called for an in-band failed outcome and `finalize()` is not, alongside the existing test proving the reverse holds for a success.

## 0.61.5

Patch: a failed `runtime.agents` sub-agent always reported the same unhelpful "Nested runtime failed", with no way to tell one failure from another.

- The nested runtime's own `run.failed` event carries a real `{code, message}` reason, but `RuntimeSubAgentExecutor.observe()` discarded it and hardcoded the generic string regardless of cause. Every distinct failure — a blocked model, a policy rejection, a provider timeout — looked identical in the coordinator's report, leaving nothing to act on. Hit directly: a live two-task `runtime.agents` graph reported `Nested runtime failed` for both tasks with no further detail once an earlier worktree bug was fixed, and there was no way to tell whether the fix had even taken effect.
- `describeSubAgentFailure()` now reads that reason and reports the real code and message. Covered directly with unit tests for every combination of present/absent code and message, kept dependency-free rather than reusing the VS Code host's own reason-formatting helper, which would have pulled a `vscode` import into an otherwise headless module.

## 0.61.4

Patch: `workspace.command` could not run `npm`, `npx`, or any other batch-file tool on Windows.

- Node's `child_process.spawn()` cannot execute a `.bat`/`.cmd` file directly with `shell: false` — Windows has no native way to run a batch script as a process image, so `CreateProcess` rejects it and Node surfaces `spawn EINVAL`. `npm`, `npx`, `pnpm`, `yarn`, and `gradlew.bat` all resolve to batch files on Windows, so every one of them failed this way; it first surfaced as `npm run package` failing mid-release. Reproduced directly with `spawn('...\\npm.cmd', ['--version'], {shell:false})`, which throws the identical error.
- `bounded-command-runner.ts` now spawns through `cross-spawn` instead of `node:child_process` directly. It resolves the same executable path this extension already verifies and hashes, and only adds the `cmd.exe` wrapper (with argument escaping audited against real-world shell-injection cases) when the resolved file is actually a batch script — every other command, on every platform, spawns exactly as before.
- Covered by a regression test that writes a real `.cmd` file to a temp directory and spawns it through `runCommandSpec`, gated to Windows since that's the only platform the bug exists on.

## 0.61.3

Patch: runtime.agents still rejected a valid empty array, one gate earlier than 0.61.2 fixed.

- 0.61.2 fixed the hash agreement and the coordinator's own schema, but a THIRD, separate hand-rolled JSON-Schema validator in `runtime-invocation-registry.ts` runs first, at admission time, and had no tolerance for the same empty-array/empty-object ambiguity — so a graph with an empty `integrationSeams` array still failed immediately with `must be an array`, before either of the earlier fixes ever got a chance to run. Found by hand-building a real two-task graph with verified zero write-set collisions and watching it fail anyway.
- That gate now accepts an empty object wherever an array is expected, same as the other two. A populated object, or any other wrong type, is still rejected.

## 0.61.2

Patch: a `runtime.agents` graph with any empty array field could not actually run.

- 0.61.1 fixed the receipt hash disagreement so a completed sub-agent graph could report back, but the underlying value this extension executes with was still corrupted by the same Lua round trip: `contextNodeIds`, `dependencies`, `writeSet`, `integrationSeams` and `tools` all arrive here as `{}` instead of `[]` whenever the model sends them empty, and `subAgentGraphSchema` rejected that outright — "must be an array" — for a graph the backend had admitted correctly.
- Every array field on a sub-agent task now accepts an empty `{}` and repairs it to `[]` before validating. A populated array is unaffected; a populated object in an array field's place is still rejected, since only the empty case is genuinely ambiguous.

## 0.61.1

Patch: `runtime.agents` (parallel sub-agents) could never return a result.

- Redis 7.4's Lua `cjson` cannot represent an empty array — `cjson.encode(cjson.decode('[]'))` returns `{}`, verified directly against the running server, and `cjson.array_mt` is not available to mark one as a list. Every runtime event is decoded and re-encoded inside the Lua state machine on its way to this extension, so a `runtime.agents` graph admitted with `integrationSeams: []` arrived here as `{}`. The receipt hash this extension computed from what it received then disagreed with the hash the backend had recorded at admission, and the backend rejected every completed graph as `RECEIPT_ARGUMENT_MISMATCH` — no parallel sub-agent run could ever report back, full stop.
- Both sides now treat an empty array and an empty object as the same value when hashing, matching what the Lua round trip actually preserves. Diagnosed by capturing the exact argument JSON on both sides of one failing call and diffing them byte for byte.
- Also raises `MEDIUM`, `HIGH` and `MAX` effort turn/tool-call budgets and adds a longer backoff before giving up on an empty provider response — both were cutting real edit-heavy runs short.

## 0.61.0

Minor: effort budgets retuned for editing work.

- `MEDIUM`, `HIGH` and `MAX` were calibrated on discovery runs, where a turn
  reads one file and reasons about it. Editing spends turns differently — every
  read, verification command and retry is a turn — and three supervised
  sessions in a row ended in "Runtime run exceeded its model turn budget" with
  the work half finished. One "fix this stylesheet" task spent twenty turns
  reading a 60 KB file in pieces before it could write anything. The ladder
  keeps its shape and its ordering; the rungs are simply wide enough for the
  job.

## 0.60.0

Minor: commands, restarts, capability discovery, secret scanning, and the chat panel all get more reliable.

- Structured commands now inherit the host config-directory environment (`APPDATA`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and the rest of the XDG family). `gh`, `npm`, `docker`, and other tools that store credentials and settings under those roots can now find their own configuration; without `APPDATA` every `gh` invocation failed with "You are not logged into any GitHub hosts".
- A run reopens its event stream after the backend restarts instead of failing with a terminal connection error.
- The model is offered only tools the active execution target advertises, and the capability manifest is rebuilt when workspace trust is granted so the available tool set stays accurate.
- The staged secret scan now judges the value rather than the name, so a type annotation such as `token: string` or a route constant named `passwordResetPath` no longer blocks a commit.
- The chat panel holds its layout correctly at every width, and sessions refresh their access token automatically before it expires.

## 0.59.3

Patch: searching the workspace no longer requires a glob the model was never
told about.

- `search` is keyed by its `query`, but it inherited `pattern` from the glob
  schema as a REQUIRED field. The obvious call — search the workspace for this
  string — sent `{rootKey, query}` and came back with a raw zod "expected
  string, received undefined" naming a `pattern` argument the model had no
  reason to know existed. The tool description could not help: it sits 39
  characters under a hard cap whose overflow rejects the entire run-start
  request, so there was no room to document the field.
- Watched live, a mission lost ten consecutive `search` calls to this and fell
  back to reading files one at a time to find a single constant.
- `pattern` now defaults to `**/*` for `search`, which makes the natural call
  the correct one. `findFiles` is already bounded by `maxResults`, so the
  default can never cost more than the cap the caller already accepted.
- `glob` still requires a pattern: enumerating a whole workspace is that
  operation's entire purpose, and defaulting it would hide a real mistake.
- Regressions pin the defaulted search, an explicit narrowing pattern still
  being honoured, and glob still rejecting a missing pattern.

## 0.59.2

Patch: rejected tool arguments now say what would have worked, not just what
didn't.

- A live password-reset mission sent a file-write flat — `rootKey`/`path`/
  `content` directly on `arguments`, the shape `read`/`list`/`stat` correctly
  use — instead of nested inside `transaction.operations[]`. Admission
  correctly rejected it with `Tool arguments $.content is not allowed`, but
  that message only names the key that broke, not the key that would have
  worked, so the model spent 7 tool calls cycling through `content`,
  `contentLines`, and `contentBase64` at the same wrong nesting level before
  giving up and reporting the tool as broken. The rejection now names every
  valid sibling key: `... is not allowed (expected one of: transaction)`.
- Separately, once a request nested correctly, a model that copied the
  envelope's `operation` field from an earlier successful `patch` call while
  correctly setting the new operation's `kind` to `create` got back
  "Filesystem mutation must contain exactly the requested operation" — one
  sentence covering two different checks (operation count, and operation/kind
  agreement), naming neither the count nor which two values disagreed. The
  checks are now separate and each names the actual values involved.

## 0.59.1

Patch: the tool description fits its budget again, so runs start.

- Both sides of the wire cap a tool description at 2000 characters and the
  backend rejects the ENTIRE run-start request when one exceeds it. The client
  is told only "Validation failed", with nothing naming the field, so a run that
  never began looked like a broken model. Documenting the operation shapes had
  quietly grown this description past the cap.
- The description is rewritten to say the same things in fewer words, and a
  regression now holds it at 1600 characters — deliberate headroom, because the
  failure mode is a dead run rather than a truncated string.
- The chat service now logs the offending field and rule whenever a request
  fails validation. The response already carried them; nothing wrote them down,
  which is what made this take a bisect to find.

## 0.59.0

Minor: source code can be sent as an array of lines, which is what actually
made writing code work.

- 0.58.0 added base64 to dodge JSON escaping, but base64 trades an escaping
  problem for an encoding one: asking a model to base64 a page of source is a
  character-level transform it performs unreliably.
- A line array asks for neither. `contentLines` stands in for `content`, and
  `beforeLines`/`afterLines` for a hunk's halves. Each element is one ordinary
  short string with no line break inside it, so nothing has to be escaped, and
  writing code line by line is what a model already does well. The catalog now
  recommends this form first for source and keeps base64 as the alternative.
- Both forms are decoded before the strict transaction schema runs, so
  containment, hashes, previews, receipts and rollback are untouched, and a
  plain-text transaction behaves exactly as before. Sending two forms of one
  field is refused rather than silently preferring either.
- Regressions pin joining for create and for both halves of a hunk, the
  both-forms refusal, and a non-string element being rejected.

## 0.58.0

Minor: file content can be sent as base64, so writing code stops depending on
the model escaping it perfectly.

- Writing a file means putting source into a JSON string, and every quote,
  brace and newline in that source has to survive the model's own escaping. It
  does not. A live mission created an 808-byte SQL migration successfully and
  then failed every attempt at a TypeScript file: the request stopped being
  parseable JSON before it arrived, and the run was told the model "started a
  tool object and did not finish it" — true, and useless. The right operation
  had been chosen and was lost to punctuation.
- `contentBase64` now stands in for `content`, and `beforeBase64`/`afterBase64`
  for a hunk's `before`/`after`. Base64 carries no character JSON must escape
  and no brace or quote to confuse a parser, so a code payload arrives intact.
  The catalog tells the model to prefer it for source code.
- Decoding happens before the strict transaction schema runs, so every existing
  path — containment, hashes, previews, receipts, rollback — is untouched and
  a plain-text transaction behaves exactly as before. Sending both forms of one
  field is refused rather than silently preferring either.
- Regressions pin decoding, substitution for create and for both halves of a
  hunk, an untouched plain-text transaction, the both-forms refusal, invalid
  base64, and non-transaction input passing through.

## 0.57.6

Patch: patching a file on a Windows checkout works at all.

- The read operation normalises a file to `
` before the model ever sees it,
  so a model looking at a CRLF checkout is shown LF and faithfully echoes LF
  back in its hunk. The patch applier matched that against the raw bytes, so on
  any CRLF checkout the context could never be found: every `patch` failed with
  "Exact patch context is missing or ambiguous", which reads like the model got
  the context wrong when the context was exactly right.
- Measured on a live repository during a mission: the target file held 621 CRLF
  and zero bare LF, the model's LF hunk matched zero times, and the same hunk
  in CRLF matched exactly once. The agent burned several attempts on it and
  fell back to rewriting whole files with `update`, which is what destroyed a
  schema's comments.
- A hunk is now converted to the line ending the document actually uses, in
  both directions, and the replacement text is converted with it so a patch
  cannot leave mixed endings behind. A hunk that matches the raw bytes exactly
  is still honoured, so a mixed-ending file keeps working.
- Regressions pin an LF hunk against a CRLF document, ending preservation, an
  ordinary LF document, a hunk already written with CRLF, and that genuinely
  missing or ambiguous context is still refused.

## 0.57.5

Patch: the file tool now documents every operation it advertises, so editing a
file no longer destroys it.

- The catalog advertised fourteen filesystem operations but spelled out the
  transaction shape for only `create` and `update`. The nested transaction is
  reported to the model as an empty object, so `patch`, `rename`, `copy`,
  `delete`, `mkdir` and `artifact` were undiscoverable and had to be guessed.
- `patch` takes exact hunks — `{"before":"<text present now>","after":"<new
text>"}` — but nothing said so. A live mission tried three different spellings
  of a unified diff (`"content":"PATCH\n@@ …"`, `"patch":"@@ …"`,
  `"content":"@@ …"`), failed every time, and fell back to a whole-file `update`
  that silently deleted about forty comments from a Prisma schema it had only
  meant to add one model to.
- Every advertised kind now carries its exact shape, `patch` is described as
  exact replacement rather than a diff with the uniqueness requirement its
  applier enforces, and `update` is labelled as replacing the whole file so the
  cheaper and safer operation is the obvious one.
- A regression derives the kind list from the transaction schema itself and
  fails if any advertised kind stops being documented, so this gap cannot
  silently return.

## 0.57.4

Patch: a malformed tool request no longer ends the run.

- Strict admission threw on an unknown tool or an argument that failed the
  advertised schema, and the throw escaped dispatch entirely, so the coordinator
  cancelled the run. The model never learned what was wrong and never got to fix
  it. A live mission was lost exactly this way: it read the schema, wrote a file,
  then put `content` at the top level instead of inside `operations[]` and died
  on `Tool arguments $.content is not allowed`.
- Admission now records the request and reports a rejection instead of throwing.
  The dispatcher completes it as an ordinary `failed` result carrying
  `TOOL_ARGUMENTS_INVALID` and the exact validation message, so a `continue`
  continuation stays alive and the next turn can reissue the call with the right
  shape. Policy and the executor are never reached, so a refused request cannot
  become an effect, and the result is stored and replayed by invocation identity
  like any other.
- Regressions pin the malformed-argument path, the unadvertised-tool path, the
  surviving run lifecycle, and that a valid request still executes untouched.

## 0.57.3

Patch: the agent can run commands again — every command root was rejected
before it did any work.

- A runtime target advertises its folders as `workspace-1`, `workspace-2`, and
  the structured-command catalog ships `{"cwdRootKey":"workspace-1"}` as its
  worked example. The filesystem adapter resolved that advertised form for file
  operations but not for command roots, which still matched only the SHA-256
  folder key. Nothing registers the ordinary workspace as a runtime root — only
  sub-agent worktrees do — so `workspace-1` matched nothing and the model was
  refused the exact value it had been told to send.
- Every consumer of a command root failed the same way, before touching disk:
  structured commands, the quality gates, git, the database tool, the container
  engine, elevation, the process supervisor, development-service discovery and
  the intelligence index. A run could read and write files but could not run a
  migration, a test or a lint to verify them, so feature-scale work could not be
  completed or checked.
- Command roots now resolve the advertised index exactly as file roots already
  did. An explicitly registered runtime root still wins, so a sub-agent worktree
  cannot be escaped, and an out-of-range index or a near-miss key is still
  refused rather than falling back to the first folder.
- Regressions pin the advertised key, multi-root folder separation, worktree
  precedence, an out-of-range index, and near-miss rejection. The previous
  coverage passed only because the test registered `workspace-1` as a runtime
  root, which production never does; the new tests exercise the production path.
- The shared-refresh session test no longer races the scheduler. It now waits
  for both clients to consume their initial 401 before completing the rotation,
  which removes an intermittent failure that only appeared under full-suite CPU
  load.

## 0.57.2

Patch: oversized tool output now becomes recoverable model feedback instead of
ending the run.

- Runtime V2 now validates the complete trusted-executor output before result
  completion. Invalid structured data or oversized model text becomes a fixed,
  non-retryable `TOOL_OUTPUT_INVALID` result without echoing raw adapter data or
  schema diagnostics.
- The failed result is stored and replayed by invocation identity. A
  `continue` continuation remains active, the backend receives the canonical
  failure, and the model can narrow its request or choose another tool on the
  next turn. Possible mutations are explicitly not retried automatically.
- Workspace list, glob, and search now share the Runtime V2 collection limit of 100. List pagination exposes `nextCursor`; saturated glob/search results are
  marked `truncated`, including searches that inspect 100 candidate files but
  find fewer matching lines. The tool catalog advertises the exact limit and
  recovery guidance.
- Dispatcher, run-service, catalog, and VS Code filesystem regressions pin
  bounded output, safe failure materialization, exact replay, transport
  submission, recovery turns, pagination, candidate saturation, and rejection
  of explicit limits above 100.

## 0.57.1

Patch: a rejected tool request can no longer leave a run spinning forever.

- A tool request rejected by strict admission was launched beside the event
  stream, but its failure was only latched. Heartbeats skipped it, a reconnect
  could strand it, and the panel stayed on `Running` while the backend waited
  for a result that could never arrive.
- The first dispatch failure now interrupts response acquisition, body reads,
  heartbeat-only streams, reconnects, and terminal waits. The exact failure is
  surfaced promptly so the coordinator can cancel the broken run and the user
  can retry.
- Cancellation no longer waits for a pending tool dispatch or a stream whose
  cancel hook refuses to settle. Strict file-tool validation remains unchanged;
  malformed file requests fail fast instead of being silently rewritten.
- Structured commands now take their target from the authoritative tool
  envelope. The model no longer has to duplicate `targetId` inside arguments,
  and a stale nested value cannot redirect execution. The catalog now exposes
  the real required fields, six allowed `expectedEffect` values, the `cwd: "."`
  convention, and a complete example.
- Event-stream regression coverage pins normal dispatch and steering,
  already-ended runs, heartbeat-only failure, reconnect failure, terminal waits,
  and non-cooperative cancellation cleanup. Command-contract coverage pins
  target authority and keeps the advertised schema aligned with execution.

## 0.57.0

Minor: a run can now work long enough to finish a feature.

- ULTRA — the default effort — was byte-identical to the pre-effort-modes
  fixed budget: 40 model turns. A feature-scale mission died of it live: the
  agent spent every turn on legitimate discovery reads of a large monorepo and
  was ended by the budget before writing a single file. The runtime protocol
  schema allows 100 model turns and 500 tool calls; the top rung stopped at
  less than half of that ceiling.
- ULTRA now buys the protocol ceiling: 100 model turns, 250 tool calls. XHIGH
  rises to 60 turns and 160 calls so the ladder keeps real steps. Every other
  rung is unchanged.
- The compatibility guarantee is restated in the direction that matters: the
  default never buys LESS of anything than runs historically had. A bigger
  ceiling cannot fail a run that used to pass; a smaller one can. The legacy
  fixed budget stays pinned in a test as the floor.

## 0.56.2

Patch: password-feature files are code, not credentials — and a refused path
now says why.

- The sensitive-name rule denied every path merely CONTAINING "password", so
  an agent asked to build password reset could not read or write any file the
  feature consists of — `password-reset.controller.ts`,
  `reset-password/page.tsx`, even the task brief that assigned the work.
  Screened live: a model produced the correct path 38 times, was refused every
  time, and ran out of budget. The bare `token` word rule had the same
  overreach one directory later (`…_add_password_reset_token/` migrations).
- Password and token names now get word-boundary and shape care, the way
  `token` already had boundaries: standalone names outside code modules stay
  denied (`passwords.txt`, `token.txt`, `password.md`, a `passwords/`
  directory, `etc/passwd`), any compound with a data-shaped extension stays
  denied (`user-passwords.csv`, `password-dump.json`), and feature code and
  prose pass. `secret`, `credential`, `api-key`, `private-key`, and
  `access/refresh/auth`-token compounds keep the strict substring rule — those
  name the credential itself. `.env`, key files, and the exact-name list are
  untouched.
- The path refine used to fail with zod's bare "Invalid input", which reached
  the model as its whole explanation — a model holding a valid path was told
  the path was invalid. The refusal now states the rule it applied.
- Four tests pin the boundary from both sides: credential stores stay denied,
  feature files pass, standalone names stay protected outside code modules,
  data-shaped compounds stay denied.

## 0.56.1

Patch: a failed tool no longer ends the run before the model can react.

- 0.56.0 made a failed tool say what went wrong, but the run still died before
  the model's answer to that error could execute. `RuntimeToolDispatcher`
  terminalized on every `failed` result regardless of the continuation, closing
  the invocation registry — while `RuntimeRunService`, by design, kept the run
  alive and submitted the error to the backend. The model reasoned about the
  failure and asked for its next tool, and that recovery turn hit the closed
  registry: `beginModelTurn` threw `RuntimeRunEndedError`, the stream stopped
  following, and the coordinator cancelled the run as abandoned. The user saw a
  cancelled run; the backend kept executing one nobody was listening to.
- A `failed` step now defers to the continuation exactly as a succeeded one
  does, mirroring `terminalSteeringLifecycle`: under `continue`, the failure is
  the model's next input, not the run's end. `denied`, `cancelled`, and
  `timed-out` still terminalize unconditionally — the first two are human
  decisions to stop, the third means the run's whole deadline is spent.
- Failure loops stay bounded: every dispatch still debits the tool-call and
  tool-round budget, so a model that keeps failing runs out of budget, not out
  of control.
- Three tests: the dispatcher stays active after a failed step under
  `continue` and executes the recovery invocation; a failed step on a `final`
  continuation still ends the run as failed; and at the service level, the
  model's recovery turn after a failed step dispatches end to end.

## 0.56.0

Patch-level behaviour, minor bump: a failed tool says what went wrong.

- `RuntimeToolDispatcher` caught an executor failure with `catch {` — no error
  parameter — and replaced whatever was thrown with one fixed sentence, "The
  trusted tool executor failed." A conformance screen of 21 hosted models found
  17 of them producing a valid `workspace.files list` request that failed with
  exactly that message and exactly 166 bytes, every time. Nothing in the panel,
  the Output channel, the run journal or the backend logs said why. One model's
  own reply was "the trusted executor returned a non-retryable failure", because
  that was all it had been told.
- The thrown reason now travels with the error, so the model can react to it and
  a reviewer can read it.
- It is passed on raw, deliberately. `buildRuntimeToolResult` already runs every
  tool error through `sanitizeError`, which redacts it and derives
  `redactionApplied` from whether its own pass changed anything. A first version
  of this fix redacted in the dispatcher as well, which left that pass nothing to
  do and reported `redactionApplied: false` for a message that had in fact been
  scrubbed. Redaction stays in one place.
- Three tests: the reason reaches the model, a blank executor message still
  yields the bare sentence, and a secret in a failure message does not survive
  into the result.

## 0.55.0

Minor: speed modes exist, and the settings popover stops hiding half of itself.

- **The popover was clipping its own labels.** `.secondary-controls` is
  positioned above its summary inside `.composer-card`, which clips overflow —
  so once a fifth control pushed the panel to three rows, the entire top row of
  labels sat 32px above the card edge and was cut off. The controls were still
  there and still worked; they just had no visible names, and the panel looked
  shifted into the composer. The clip is now released only while the popover is
  open. Measured before and after in a browser, not eyeballed.
- The popover also squeezed its columns until "Ask for Approval" read "Ask for
  Appro". Columns are `auto-fit` now and the panel is wider, so adding a control
  reflows instead of truncating, with a height cap so nothing can push it off
  screen again.
- **`clawAI.speedMode` adds 1X, 1.5X and 2X.** Building workspace context did a
  containment check, then a stat, then a read — strictly one file at a time, for
  up to forty files. The containment checks and stats now run four (1.5X) or
  eight (2X) at a time.
- **What speed deliberately does not do.** Reading a file's bytes stays serial
  and conditional on the running byte total. Parallelising that is faster and
  pulls every near-limit candidate into memory only to discard it — the existing
  suite caught exactly that regression during development, and the memory bound
  it guards is worth more than the latency. Approvals, writes, commands and the
  set of files that end up in context are untouched at every speed.
- The order-dependent part stays ordered. Which files fit depends on how many
  bytes the ones before them consumed, so the lookups overlap while the decision
  that consumes them stays strictly sequential. A test asserts the produced
  context is byte-identical at 1X, 1.5X and 2X, including under a byte limit
  that truncates — a comparison that would be vacuous if nothing were excluded,
  so the test checks that too.
- A speculatively prefetched neighbour cannot raise an error the one-at-a-time
  path would never have produced: a prefetch failure is held and surfaced only
  if the sequential loop actually reaches that file.
- 1X is the default and is the previous behaviour exactly.

## 0.54.0

Minor: how hard a run may work is now a choice, and the choice does something.

- Every run received one hardcoded budget — forty model turns, a hundred tool
  calls, a two-hour clock — whether it was a one-line edit or a cross-service
  feature. `clawAI.effortMode` picks from six: Low, Medium, High, Max, xHigh,
  Ultra. Each resolves to a genuinely different `RunBudget`, and the runtime
  starts the run with the one the setting chose.
- **Nothing changes until you choose.** Ultra is the default and is
  byte-identical to the budget that was hardcoded, so an upgraded install
  behaves exactly as it did. Spending less is opt-in — which is the safe
  direction, because a default that quietly lowered a limit would fail long
  runs that had never had to respect one.
- The names are checked, not asserted. The test suite fails if any two modes
  resolve to the same budget, if a stronger mode buys less of any dimension
  than a weaker one, if Ultra stops matching the historical constant, or if the
  runtime stops sending the selected budget to the transport. Six labels
  mapped to identical behaviour would be worse than no labels at all.
- Two limits belong to the budget schema rather than the ladder, and are
  documented rather than worked around. `maxRepairAttempts` is bounded `0..1`,
  so it cannot form a six-step ladder: Low spends it — a malformed tool call
  ends the turn instead of being retried — and every other mode keeps its
  single repair. Wall clock, output bytes and tool-result bytes were already
  pinned at the schema ceiling before this change, so the ladder reaches that
  ceiling at Ultra instead of exceeding what the product already did.
- Each run's observability trace and durable journal record the mode in force.
  Two runs at different efforts now produce different policy snapshot hashes,
  because a run that was allowed to spend more is not reproducing the same
  conditions as one that was not.
- The composer gained an **Effort** control beside Agent and Approval, and a
  pending selection survives a state frame that still reports the old mode
  rather than snapping back mid-change.

## 0.53.0

Minor: the Cloud lane is a real destination, not a placeholder.

- Backend and Frontend each offered a Cloud choice that was rendered dimmed and
  `disabled`, and the resolver behind it threw "ClawAI backend cloud is not
  available yet." The hosted deployment now exists: `https://claw-ai.co` serves
  the API and the web app from one origin behind a publicly trusted Let's
  Encrypt certificate. Cloud selects it, on the connection gate and in the App
  connections dialog, for the backend and the frontend independently. The
  webview message schema accepted only `LOCAL` and `CUSTOM`, so a Cloud
  selection would have been rejected at the extension boundary even with the
  radio enabled; it now accepts the lane the UI can produce, and `STAGING` or
  any other invented value is still refused.
- The gate used to hard-code `https://claw.local` in six places next to a
  resolver that decided the real origin somewhere else. Both now read the same
  exported constants, so a label cannot advertise an origin the extension will
  not connect to.
- Sessions were already keyed by a digest of the normalized backend origin, so
  Local and Cloud hold separate credentials. Switching lanes disconnects the
  current one and restores the other if it was authorized; it does not delete
  the session left behind. Documented rather than changed — the behavior only
  became reachable now that a second lane exists.
- `clawAI.backendEnvironment` and `clawAI.frontendEnvironment` accept `CLOUD`.
  A settings file that already carried the value parsed but resolved to a
  throw; it now resolves.

## 0.52.0

Patch to 0.51.0: a locally decided ending reaches the panel and stops there.

- 0.51.0 sent those endings to the run-state reducer as well, and every run died
  with "Runtime event sequence must advance from 40 to 41". The reducer's ledger
  belongs to the backend and admits events strictly in sequence; these carry the
  run service's own counter, which is a different series. They now go to the
  panel and nowhere else, through a forwarder that is given a panel callback and
  no ledger — so the mistake cannot be made again. Caught by the confirmation
  round in a real VS Code window, not by review.

## 0.51.0

Minor: a refused run says so, and a slow turn is not a failed one.

- A run stopped by policy — a tool the user denied, a mode that forbids it —
  ends on this side, and the backend never learns of it, so it never streams a
  terminal back. Those locally decided endings were published into a sink that
  discarded them, and the panel reported "The ClawAI run ended without reporting
  a result" for a run that had stopped exactly as intended. Terminals raised
  here now reach the panel, and `run.blocked` is treated as the outcome it is:
  whatever the agent produced is kept, followed by a line saying an operation
  was not permitted.
- Runtime commands are no longer held to the ordinary one-minute request budget.
  Posting a tool result hands the run back to the platform, which calls the model
  and only then answers, so the request stays open for as long as the turn takes
  — and the platform's own provider timeout is five minutes. Any turn slower than
  a minute was aborted from this side while the backend was working perfectly
  well, and the panel reported "ClawAI request timed out." Seen twice in the
  final sweep, at 70 s and 110 s. Ordinary requests keep the one-minute budget.

## 0.50.0

Minor: an internal sentence is no longer the answer.

- A run that ends between a stream frame arriving and its turn opening — which
  is what Enterprise-locked mode does, correctly refusing the first tool it is
  asked for — replied "Runtime invocation registry is terminal" and nothing
  else. That condition is now a named error the stream recognises, and the
  reader stops instead of raising it at the user.

## 0.49.0

Minor: a run that ends stops being in the way.

- One failing tool step used to end the whole run on this side while the
  backend, correctly, handed the error back to the model and kept going. The
  two halves then disagreed: the next tool request found nothing active and
  threw, and "No runtime run is active" was shown to the user as the
  assistant's answer, eleven seconds into a run whose only fault was one tool
  returning an error. A failed step is now what the backend already treats it
  as — the model's next input.
- Cancelling when nothing is active is success rather than an error. Because
  the coordinator awaited that call before telling the backend to stop, the
  throw skipped the cancel entirely, and the run left running on the server was
  exactly the one the user had asked to stop. Each stage of a cancel is now
  best effort and the remote stop always runs.
- A run nobody is following any more is told to stop, so the backend no longer
  executes a run whose answer can reach no one while holding the single runtime
  slot against the next prompt.
- Approval prompts belonging to a finished run are withdrawn. An unanswerable
  prompt is modal: it swallowed every click meant for the composer, so the next
  message could not be typed at all until the window was reloaded.
- Stream frames that arrive after the run has ended are ignored instead of
  being dispatched into nothing.

## 0.48.0

Minor: the agent can finally write a file.

- Every mutation goes through a nested transaction, and the tool catalog
  reported that argument as an empty object while the description never
  mentioned it — so a model had to guess the shape, and across eight different
  models none ever did. The description now spells the transaction out:
  transactionId, summary, and one operation carrying kind, rootKey, path,
  content and beforeHash. This is the same channel that had to be taught the
  rootKey convention in 0.41.3; it is the only guidance that reaches the model.
- A stream frame the schema rejects no longer surfaces as a raw list of
  validation issues. A platform error frame reports its own reason and code,
  and anything else says plainly that the event could not be read.

## 0.47.0

Minor: a backend failure now reads as a sentence.

- A run that ended because the provider returned no content showed the whole
  HTTP envelope in the panel — statusCode, timestamp and all — with the actual
  reason buried inside the JSON. The reason and its code are now shown on their
  own, and anything that is not a platform error body is left exactly as it was.

## 0.46.0

Minor: Ollama cloud models are usable again.

- Choosing any Ollama cloud model failed with "Unauthorized". The local Ollama
  daemon also lists the cloud models it can proxy, and the catalog claimed all
  of them as local, so the local entry shadowed the connector entry that holds
  the credentials and the request was dispatched to the local runtime. A
  cloud-tagged model now comes from its connector, which is also the truthful
  source for tool support — the local entry hardcoded it to false, which made
  every cloud model look incapable of using tools.

## 0.45.0

Minor: a second prompt now waits its turn instead of failing.

- Sending another request while an agent run was working failed instantly with
  "A Runtime V2 run is already active in this extension host" — an internal
  message shown to a user whose only mistake was asking a second question. The
  runtime holds one active run per window, so agent runs now share one queue
  and the next request starts when the current one finishes, which is what the
  run deck already showed.

## 0.44.0

Minor: the agent can be told about folders outside the workspace.

- Asked to write a file outside the workspace the agent replied that it could
  not, which was wrong whenever an output folder had been approved and
  unhelpful when none had. The approved folders were always addressable by the
  file tools; the tool catalog simply never mentioned them. It now names every
  approved output folder and its root key, and when there are none it says the
  folder has to be approved with the Output folders action first.

## 0.43.0

Minor: you can see what the agent is doing, and when it is waiting for you.

- The response card showed one static line for a whole run. Every tool the
  agent requests, starts and finishes now appears in the run activity with its
  name, operation, outcome, size and duration, so a working run no longer looks
  identical to a hung one.
- A run blocked on the approval dialog reported nothing at all. The card now
  says it is waiting for your approval, names the exact effect, and records
  whether you approved or rejected it.

## 0.42.0

Minor: the agent now always tells you how a run ended.

- A Runtime V2 agent run projected only its streamed text to the panel. When a
  run failed, completed, or was cancelled the response card was told nothing at
  all, so it kept its "Reading workspace" placeholder while the generation
  quietly settled and released the request — a card that could never finish.
  Every run now ends in exactly one visible terminal state: the answer, the
  failure with its stable reason and code, or a cancellation that keeps whatever
  had already streamed. A stream that ends without any terminal event says so
  rather than leaving the card running.
- The replay test that guards this path read its captured journal from an
  absolute path inside one developer's temporary directory, so it proved nothing
  in a fresh clone and could pass on a stale capture. The sanitized journal now
  lives in `tests/fixtures/journals/`, is resolved relative to the test module,
  and `npm run scan:paths` fails the gate on any machine-local path a test
  actually opens.

## 0.41.4

Patch: diagnostics for an answer that streams but never renders.

- A run was observed emitting its answer and completing while the panel stayed
  on "Reading workspace". Replaying that exact run journal through the real
  stream service and reducer delivers every delta and reports the run terminal,
  so the loss is in the hop from the coordinator to the panel. The coordinator
  now records each delta it posts with its request id and whether a view was
  attached, and the panel reports a delta that arrives for a request it has no
  bubble for instead of dropping the text in silence.

## 0.41.3

Patch: makes `workspace.files` usable at all. Three defects, each of which on
its own made "gain context on this workspace" impossible. A run captured
against a live backend showed the model calling `list` with
`{rootKey: "workspace", path: ""}`, the tool failing in 1 ms without touching
the disk, the model retrying, and the run stranding with no answer.

- Lets the workspace root be addressed. Every spelling of it — `""`, `"."`,
  `"./"`, `"/"` — was rejected by the relative-path policy, so no value meant
  "the root". An agent had to name a subdirectory to list, but could not list
  the root to discover one, which made the first tool call of any exploratory
  task impossible. Enumeration now accepts the root; reads and mutations keep
  the stricter rule, and every containment and secret-denial check is unchanged.
- Makes the advertised `rootKey` the one the filesystem actually approves. The
  capability manifest advertised `workspace-1` while the filesystem adapter
  resolved only the SHA-256 folder key, so even a model that used the
  advertised value got "The requested filesystem root is not approved" — every
  invocation was unsatisfiable. Both sides now derive the convention from one
  place so they cannot drift apart again. A near miss such as `workspace` or
  `workspace-0` is still rejected rather than resolved to the first folder.
- Tells the model the argument convention. The tool description is the only
  guidance that reaches it: the catalog carries a bare input shape, and the
  manifest that knows the roots goes to the backend as a hash. It now states
  the `workspace-N` scheme and how to enumerate a folder root.

## 0.41.2

Patch: a compatible correctness fix to event validation, with no new workflow.

- Shows why a run ended instead of replacing the reason with a protocol error.
  Terminal events (`run.failed`, `run.blocked`, `run.cancelled`,
  `run.completed`) were validated against a strict empty payload, so once the
  backend began attaching a reason — added precisely so a client could explain a
  failure — every failed run was rejected here as an invalid payload. A run that
  the model correctly refused surfaced as `Runtime event run.failed has an
invalid payload` rather than the actual cause, which is worse than the silence
  it replaced. Terminal payloads now accept an optional `{ code, message }`
  reason; `run.created` keeps the empty payload.

## 0.41.1

This corrective release restores tool dispatch for trusted local workspaces and
stops a repair round from compounding conversation context.

- Separates a target's execution readiness from its network reachability. The
  workspace target previously reported `online: false` unconditionally, so
  `ExecutionTargetRegistry.select` rejected every invocation with
  "Execution target is offline" before its epoch and capability checks ran. A
  trusted local workspace is now dispatchable while the host has no internet.
- Stops claiming internet reachability as a side effect of execution readiness.
  A registered target now reports `workspace-only` until a probe proves more,
  rather than fabricating `internet` from an unrelated flag.
- Bounds the previous response echoed into an edit-plan repair prompt. Because a
  repair is sent on the malformed response's own thread, echoing it back
  verbatim duplicated the turn and let each round compound the context until the
  provider returned no message content. The echo is now capped and the elision
  is marked explicitly.

Paired backend change in `claw-chat-service`: a Runtime V2 run that ends in an
agent-self capability denial is corrected once and then failed with
`MODEL_CAPABILITY_DRIFT`, instead of storing the refusal as a completed
successful answer. Genuine safety refusals and truthful factual negatives are
unaffected.

## 0.41.0

This release restores first-message execution for Runtime Protocol V2 and makes
the model used for every chat exchange visible and durable.

- Creates and binds the backend conversation thread before a new Runtime V2 run
  starts, preventing the missing persisted-thread error.
- Shows the submitted model on both user and assistant message cards, replaces
  the assistant label with resolved provider/model provenance, and preserves
  labels on failures and reopened conversation history.

## 0.40.1

This corrective release completes and hardens the Runtime Protocol V2 work
delivered in 0.40.0 without moving or replacing the immutable 0.40.0 tag.

- Enforces trusted host-side authorization for Git, integration, flagship, and
  native elevation operations instead of accepting model-authored authority.
- Hardens durable run admission, binding cleanup, idempotent tool dispatch,
  verified commit provenance, bounded sub-agent execution, and global flagship
  budgets and steering.
- Advertises Runtime V2 capabilities only when their local prerequisites are
  available and adds strict nested schemas for orchestration requests.
- Adds a signed, time-bounded elevation request and receipt protocol with
  workspace containment, executable identity checks, and read-only
  postcondition verification.

## 0.40.0

This consolidated pre-1.0 release advances the model-neutral Runtime Protocol
V2 foundation through the Autonomous Studio GA architecture while retaining the
supported V1 compatibility path.

- Adds schema-validated, cancellable, budgeted tool execution with ordered
  events, idempotent replay, epoch-bound targets, one-shot approvals, bounded
  results, redaction, and explicit terminal states.
- Adds transactional workspace files; direct structured commands; owned PTY
  processes; guarded Git and worktree operations; ownership-labelled Docker and
  Podman operations; secret-backed database profiles; and dependency-ordered
  quality gates with root-cause retry budgets.
- Adds isolated Playwright browser sessions with semantic locators, origin
  policy, user takeover, readiness waits, screenshots, PDF, traces,
  accessibility/layout evidence, and download limits.
- Adds incremental workspace intelligence, evidence-backed implementation
  plans, bounded multi-agent DAGs and file leases, development-service
  discovery/control, and target-aware WSL/SSH/Dev Container semantics.
- Adds encrypted durable run journals, context-compaction references,
  drift-aware resume, sanitized deterministic evidence ZIP/Markdown exports,
  local-first observability, signed enterprise policy contracts, and SBOM
  generation.
- Rebuilds the Agent Cockpit around a vivid ordered activity timeline,
  inspectable tool receipts, visible token/budget meters, native-language
  selection, stronger typography, responsive spacing, pointer affordances, and
  accessible status semantics.
- Documents onboarding, supported/preview/best-effort targets, privacy,
  migration from prior runtime generations, rollback, immutable safety rails,
  and the Runtime V2 threat model.

### Security and compatibility

- Backend identity, entitlement, provider credentials, inference, routing, and
  research remain backend-authoritative; local effects remain
  extension-authoritative.
- Commit, push, deployment, publication, production mutation, and elevation
  remain separate effects. No autonomous scope can grant arbitrary shell or
  native elevation.
- Attachments and research retain the compatible V1 payload lane when Runtime
  V2 cannot represent them, preventing silent request data loss.
- Cloud connection options remain visibly unavailable until their endpoints are
  finalized; Local and explicit Custom endpoints remain supported.

## 0.18.0

- Establishes a strict, model-neutral Runtime Protocol V2 foundation while
  preserving the complete legacy V1 chat and reviewed edit-plan path.
- Adds a truthful capability manifest for local, WSL, SSH, Dev Container,
  Codespaces, web-limited, virtual, multi-root, and untrusted VS Code hosts
  without running discovery commands or uploading workspace details.
- Adds one immutable ordered-event reducer with global event identity,
  per-run sequence and epoch enforcement, idempotent replay, terminal-state
  protection, strict known payloads, and inert future-event compatibility.
- Negotiates the authenticated agent-service protocol descriptor after profile
  validation, automatically refreshes an expired access token, and safely
  retains V1 when the additive endpoint is absent, incompatible, or malformed.
- Keeps Runtime V2 tool execution disabled until the separately gated 0.19.0
  release and introduces no executable, native binary, PTY, or shell executor.

## 0.17.0

- Separates Backend and Frontend connection profiles so API traffic and browser
  authorization can target independent Local or Custom ClawAI deployments.
- Adds persistent, validated environment controls to first-run connection and
  authenticated settings, with safe session-boundary handling when the backend
  changes and immediate frontend-link updates without logging out.
- Shows Cloud for both endpoints as a visibly disabled coming-soon option until
  the hosted endpoints are finalized.
- Opens authorization pages on the selected Frontend while token exchange,
  models, chat, and agent operations remain bound to the selected Backend.
- Adds localized UI, keyboard-accessible dialogs, disabled-state coverage, and
  end-to-end regression tests for connection profiles.

## 0.16.1

- Fixes external output-folder labels on Linux and macOS runners when a saved
  grant originated from a Windows path, restoring cross-platform CI and VSIX
  publication without changing the permission boundary.

## 0.16.0

- Adds workspace-scoped, revocable external output-folder permissions so a
  model can create or update requested deliverables outside the source
  workspace after the user selects a folder with the native picker.
- Freezes allowed output roots with each admitted request, supports both the
  explicit `rootKey` plan contract and safe normalization of absolute paths
  under a granted root, and rejects unknown roots, traversal, secrets, deletes,
  commands, and symlink escapes.
- Requires a separate final-diff approval for every external write, including
  in Full Access mode, and keeps external outputs ineligible for automatic undo
  because that would require an external delete.
- Adds an Output folders control under More settings for granting and revoking
  access, with localized permission and safety guidance.

## 0.15.0

- Treats a rejected refresh token as a terminal expired-session boundary,
  securely clearing only the matching account session instead of leaving the
  extension falsely connected and trapped in repeated 401 responses.
- Returns editor chats, native Chat, queued generations, attachments, and
  account-scoped state to a safe disconnected state with a localized reconnect
  message when refresh credentials expire or are revoked.
- Adds regression coverage proving a refresh 401 clears the poisoned session
  and never retries the original protected request.
- Includes the full-release-notes publication gate introduced in 0.14.2.

## 0.14.2

- Made every automated GitHub Release publish the complete matching changelog
  section instead of sparse generated commit notes.
- Added verified-gate, reproducible-artifact, and VSIX installation details to
  every future release description.
- Added a packaging regression gate that rejects release workflows which omit
  curated versioned notes or revert to generated-only notes.

## 0.14.1

- Fixed the Linux extension-host and release workflows by validating the
  activated extension against the current package manifest instead of a stale
  hard-coded `0.12.0` version.
- Prevented future version bumps from failing an otherwise healthy release gate.

## 0.14.0

This pre-1.0 minor release redesigns the coding workbench as a clearer,
more energetic model cockpit.

- Rebuilt the status surface around a vivid **Current model** signal with
  human-readable routing, context, and agent-behavior labels.
- Replaced the ambiguous account-plan value and raw `MANUAL_MODEL` contract
  with coding state that reflects what the agent will actually do.
- Made context usage visible as both file count and collected bytes, including
  an honest pre-run state instead of a misleading zero.
- Added a prominent language control wired to VS Code's locale selector and
  translated the new cockpit vocabulary across all 12 supported non-English
  locales.
- Refined typography, spacing, tokens, focus, responsive layouts, and visual
  hierarchy while retaining VS Code theme and forced-color compatibility.
- Regenerated dark, light, narrow, parallel-run, and comparison snapshots and
  expanded browser regression coverage for the new semantics.

## 0.13.0

This pre-1.0 minor release hardens first-run connectivity and makes browser
authorization truthful, secure, and release-ready.

- Replaced raw transport errors such as `fetch failed` with an actionable,
  localized ClawAI backend availability message.
- Deferred the loopback success response until the authorization code,
  candidate tokens, and authenticated profile have all been verified.
- Added a polished, CSP-nonce-protected callback experience with explicit
  success and failure states, safe automatic tab closing, and no remote assets.
- Preserved cancellation, timeout, PKCE, origin-scoped session, and concurrent
  sign-in protections with new lifecycle regression coverage.

## 0.12.0

This pre-1.0 minor release adds an explicit, quota-safe online research
workflow for cloud and local models.

- Added Off, Search, Search + fetch, and Search + extract modes under More
  settings, with research disabled by default.
- Routed research through ClawAI's configured multi-provider evidence layer so
  offline models can work from current cited sources without direct network
  access.
- Kept token consumption distinct from web-search and fetch request counts;
  Ollama remaining session quota is not estimated because the provider does not
  expose it through an API.
- Prevented ordinary Ollama generation requests from silently advertising
  provider-native web tools and consuming repeated search requests.

## 0.11.1

This patch makes the composer settings easier to discover and reliably
dismissible without changing the existing workflow.

- Promoted Settings to a high-contrast accent control while keeping Send as the
  primary action and preserving the compact narrow layout.
- Added consistent pointer feedback across enabled buttons, selects, summaries,
  and other clickable controls.
- Closed the settings popover on outside interaction or Escape, restored focus
  after keyboard dismissal, and kept interactions inside the popover open.

## 0.11.0

This pre-1.0 minor release adds a backwards-compatible parallel workflow and a
major workbench redesign.

- Added two independent execution lanes so prompts in separate chat tabs can
  run at the same time with their own snapshotted models, context, attachments,
  streams, tokens, threads, and cancellation.
- Preserved deterministic ordering within one conversation and fair scheduling
  across conversations, so a queued follow-up cannot block another chat from
  using an available lane.
- Isolated backend thread cancellation and visible agent phases per request;
  cancelling or failing one run no longer interrupts or relabels the other.
- Serialized workspace previews, approved atomic edits, and development
  commands behind a cancellable mutation gate while leaving read-only
  collection, planning, and inference concurrent.
- Rebuilt the header, run queue, and narrow composer as the responsive Signal
  Desk workbench with progressive settings, clearer hierarchy, larger type, and
  request-specific controls.
- Replaced flattened comparison text with responsive per-model result cards
  containing provider/model identity, status, latency, copy actions, and token
  usage.
- Promoted reported and estimated token telemetry into vivid, accessible
  conversation, run, response, file, activity, and comparison chips.

## 0.10.0

This pre-1.0 minor release expands attachment capacity, diagnostic tooling,
stream reliability, and the workbench UI without breaking existing settings.

- Preserved the original human request separately from enriched workspace
  context so attached screenshots are inspected without accidentally invoking
  image generation.
- Bounded image-generation prompts at the image-service contract and raised
  attachment limits to 25 MiB per file and 50 MiB per request.
- Added invisible 15-second SSE heartbeats for slow local-model responses.
- Added approved, shell-free, read-only Docker diagnostics with bounded,
  redacted output streamed into the conversation and returned to the agent for
  at most two reasoning rounds.
- Replaced ambiguous diamonds and emoji with theme-aware semantic SVG icons,
  image thumbnails, and a conventional circular connection indicator.

## 0.9.0

This is a pre-1.0 minor release because it adds the attachment workflow and
expands request, permission, session, and backend media behavior compatibly.

- Added first-class composer attachments for pasted, dropped, and selected
  screenshots, images, videos, documents, archives, and source files. Requests
  keep immutable attachment snapshots, visible file receipts, bounded upload
  progress, and retry-safe ownership without persisting file bytes in webview
  state.
- Added strict client and host validation for attachment count, individual and
  aggregate size, canonical Base64, safe filenames, and supported media types;
  uploaded file IDs now flow through chat, compare, and coding-agent runs.
- Added native video handling in the ClawAI backend: video binaries remain
  binary, AUTO routing can select a video-capable Gemini model, and unsupported
  manual providers fail with a clear capability error.
- Isolated every run from stale thread events. Reused conversations now request
  a live-only stream so a prior model selection, failure, or completion cannot
  terminate or label the next request.
- Snapshotted the selected model into each queued request, keeping rapid manual
  model changes stable from composer submission through backend routing.
- Added persistent Arrow Up/Arrow Down prompt recall while deliberately keeping
  attachment bytes out of persisted history.
- Changed confirmed **Full Access** to apply validated safe file edits without
  another final-diff prompt. Development commands remain an explicit approval
  boundary; Workspace Trust, secret exclusions, path containment, blocked
  command rules, stale-review checks, and atomic apply remain enforced.
- Hardened multi-window authentication with origin-scoped credential revisions,
  refresh serialization, provisional authorization rollback, tombstones, and
  lifecycle guards so logout or endpoint changes cannot be undone by late work.
- Hardened workspace transactions against symlink escapes, changed editor
  buffers, root changes, and cancellation races while retaining on-demand diff
  review and session undo.
- Added a repository release skill that requires SemVer classification,
  versioned builds under `builds/`, installed-VSIX verification, commit, push,
  and a matching GitHub Release asset for every shipped change.
- Scoped persisted sessions to the normalized backend origin, discarded the
  unattributed legacy credential, and staged browser credentials until profile
  validation so cancelled authorization cannot activate or overwrite a session.
- Added single-flight browser authorization with an in-extension Cancel action,
  a two-minute stalled-attempt deadline with immediate fresh-link retry,
  focus-safe connection transitions, offline logout cleanup, and account-bound
  conversation reset across retained tabs.
- Added credential and account epochs so logout or an endpoint change cannot be
  undone by a late token refresh, history load, model refresh, or profile check.
- Kept malformed edit-plan repair in the originating thread and aggregated its
  token receipts; made Compare/Judge transport cancellation real and made Retry
  replay the selected request's original mode, context, and model selection.
- Made coding and comparison commands workspace-ready without an active editor,
  retained in-extension final diff approval for Ask for Approval and Edit
  Automatically, and let confirmed Full Access apply validated safe edits
  directly while retaining persistent routine workspace consent.
- Required explicit review for every development command in every permission
  mode and rejected inline interpreter programs and outside-workspace command
  arguments before terminal execution.
- Froze each reviewed edit to its original workspace root, rejected symlink
  escapes and assignment-form outside paths, cancelled pending approvals when
  workspace scope changes, and refused to overwrite unsaved or concurrently
  changed files without a new review.
- Bound native Chat requests to immutable account, workspace, model, permission,
  and cancellation epochs so changing accounts or folders aborts live work and
  cannot submit stale context or render a stale response.
- Published the actual transport context receipt before every backend request,
  including excluded sensitive, binary, glob-filtered, over-limit, and unread
  files, and retained structured stream error metadata without exposing raw
  localization keys.
- Added bounded backend response bodies, per-event SSE idle deadlines, upstream
  cancellation, and explicit 401 body disposal so silent streams and refresh
  retries cannot leak resources or remain stuck indefinitely.

## 0.7.0

- Replaced the disconnected workbench with a focused first-run connection
  gateway. History, models, workspace controls, agent status, suggestions, and
  the composer remain hidden until authorization succeeds.
- Added an editable `https://claw.local` default, a prominent in-extension
  Connect action, secure-browser guidance, authorization progress, and inline
  connection errors without VS Code input dialogs.
- Changed the **ClawAI: Connect** command to open the same in-extension
  onboarding flow. Backend selection is normalized and persisted before the
  browser authorization starts, while the authenticated session continues to
  survive tabs, windows, reloads, and restarts.

## 0.6.1

- Fixed CI artifact publishing after the VSIX archive moved into `builds/`.
  The package audit now prevents the workflow from regressing to a root-level
  artifact glob.

## 0.6.0

- Added durable, independently titled editor-tab conversations. The top ClawAI
  action creates a fresh chat tab, and the in-tab history selector restores a
  backend conversation without replacing other open ClawAI tabs.
- Added a chronological coding timeline for lifecycle, tool, reasoning-status,
  workspace-file, and command events while keeping the composer available for
  queued follow-up prompts.
- Added visible prompt, step, file, response, and conversation token telemetry.
  Provider usage is marked **reported**; fallback estimates are explicitly
  marked **estimated** and reconcile when final usage arrives.
- Stopped automatically opening created or edited files. Proposed changes are
  staged silently and open in VS Code diff editors only when **Review changes**
  is selected from the in-extension approval or final file receipt.
- Moved every retained and newly generated VSIX into the tracked `builds/`
  directory, with release automation attaching the matching build artifact.

## 0.5.1

- Replaced the Chat participant's dark cat artwork with explicit three-scratch
  theme assets, so the ClawAI agent button beside Claude and Codex is light in
  dark themes and dark in light themes. The cat-with-laptop artwork remains the
  Marketplace listing icon.

## 0.5.0

- Added the three-scratch ClawAI navigation mark to the VS Code Activity Bar
  and editor title while retaining the cat-with-laptop artwork for the
  Marketplace listing and branded chat surfaces. Editor tabs use explicit
  white scratches in dark themes and dark scratches in light themes.
- Persisted routine consent against a stable workspace identity so accepting
  **Always allow in this workspace** survives panels, reloads, restarts, and
  extension updates without weakening final diff or command review.
- Replaced ambiguous edit-plan prompt examples with exact operation values,
  request-grounded repair, placeholder rejection, and valid create/delete
  examples for local Ollama and connected provider models.
- Added validating and repair phases, coalesced repeated transport progress,
  cleared malformed drafts before repair, and kept streamed model output in one
  response.
- Routed greetings such as `say hi` through a deterministic conversational
  path with no workspace read, approval, edit-plan parsing, or file mutation.
- Replaced the large multi-row diagnostic header with a compact route and
  activity strip plus on-demand file and command details.
- Added a gated main-branch release workflow that packages and attaches the
  versioned VSIX to a matching GitHub Release.

## 0.4.1

- Remembered the first approved routine workspace-access request in
  workspace-scoped VS Code state, so Manual mode no longer asks to read context
  and generate a proposal on every prompt. Final file and command approvals
  remain explicit.
- Accepted the common local-model `contents` edit-field alias and normalized it
  to the canonical `content` contract before strict validation.
- Treated valid zero-action edit plans as conversational replies, so greetings
  and questions no longer fail Agent mode when no file or command is needed.
- Increased the matching chat transport envelope in the ClawAI app so escaped
  workspace context reaches the validated API contract instead of failing as a
  misleading server error.

## 0.4.0

- Fixed streaming completion by normalizing backend SSE event names and added a
  serial, steerable request queue that keeps the composer and controls usable.
- Replaced repeated native permission dialogs with accessible approvals,
  Full Access confirmation, final apply, rejection, undo, and notices inside
  the ClawAI workbench.
- Replaced the custom URI callback with a state-validated one-shot loopback
  authorization callback and retained tokens in VS Code SecretStorage across
  tabs, windows, reloads, and restarts.
- Added strict safe-command plans and visible, cancellable VS Code task
  execution after file edits, with in-panel approval outside automatic modes.
- Kept all installed Ollama and ready local models available independently of
  cloud-plan grants, added model refresh and actionable source warnings, and
  kept manual selection interactive through generation and reconnects.
- Added the ClawAI cat identity to the workbench, editor title, Activity Bar,
  panel, and Chat participant with refreshed dark, light, narrow, and
  high-contrast Playwright baselines.

## 0.3.0

- Made Agent the default workbench run mode: natural-language coding requests
  now generate a strict edit plan, open diff previews, require final approval,
  and atomically apply files inside the selected trusted workspace folder.
- Fixed manual model requests to use the backend-supported `MANUAL_MODEL`
  routing contract while migrating legacy `MANUAL` settings automatically.
- Added explicit multi-root folder scope selection shared by context collection,
  project rules, diff preview, apply, and undo, without requiring an open file.
- Added a visible read, generate, review, and apply activity rail plus structured
  changed-file receipts in the editor-tab chat.
- Added one same-thread repair pass for malformed local-model edit plans while
  retaining schema validation, secret exclusions, safe relative paths,
  Workspace Trust, and fail-closed behavior.
- Added exact-prompt acceptance coverage for creating `app/for-loop.js`,
  workspace-scope tests, Playwright scope/activity flows, and a v0.3 visual
  baseline.

## 0.2.0

- Made ordinary chat workspace-ready: Smart context now falls back from the
  active selection to the active file, trusted workspace, or empty context.
- Restored installed Ollama and ready llama.cpp discovery with backend-valid
  provider identifiers, visible source warnings, and duplicate removal.
- Made manual model selection durable across configuration refreshes and
  preserved optimistic selection during state round trips.
- Added Auto and read-only Plan agent modes.
- Added Ask for Approval, Approve for me, and Full Access permission modes
  while preserving Workspace Trust, secret exclusion, path validation, atomic
  edits, and mandatory final diff review.
- Rebuilt the editor and Activity Bar webview as a VS Code-native coding
  workbench with workspace status, an execution timeline, prompt starters,
  model provenance, copy/retry actions, responsive layouts, and accessible
  light, dark, high-contrast, reduced-motion, and RTL behavior.
- Added production-webview Playwright coverage and screenshot baselines for
  responsive layout, theme tokens, workspace fallback, local/manual models,
  modes, streaming, completion, and errors.

## 0.1.1

- Replaced VS Code email/password prompts with browser authorization through
  the ClawAI web app using a one-time authorization code and PKCE.
- Added first-run backend-origin onboarding and accepted origins pasted with a
  trailing `/api/v1`.
- Added compatibility with older ClawAI token responses that omit expiry
  metadata and token type.
- Added editor-tab chat, the stable `@clawai` VS Code Chat participant, and an
  editor-title shortcut.
- Added an always-visible manual model selector with connector, installed
  Ollama, and ready llama.cpp models matching web-chat discovery.

## 0.1.0

- Added secure ClawAI account login with VS Code session provenance and
  SecretStorage-only tokens.
- Added streaming chat, thread history, cancellation, quota status, AUTO
  routing, manual selection, compare, and judge workflows.
- Added selection, file, and bounded workspace context with receipts and
  mandatory secret-path exclusions.
- Added generate, fix, review, tests, plan, documentation, and audit commands.
- Added structured edit-plan validation, diff preview, modal approval, atomic
  apply, Workspace Trust enforcement, and session undo.
- Added project `.clawai` initialization and profile-wide rules and skills.
- Added a strict-CSP, keyboard-accessible, responsive webview and VS Code-native
  tree/status surfaces.
- Added 13 package/runtime locales.
- Added CI, coverage, extension-host activation tests, security audits, and
  reproducible VSIX packaging.
