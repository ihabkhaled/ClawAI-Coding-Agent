# Changelog

All notable changes to ClawAI Coding Agent are documented here.

## 1.41.0

Minor: a command that refuses to stop no longer hangs the run (defect found under F001).

- **Termination was a request the runner assumed was obeyed.** It sent `SIGTERM`
  once and then waited for a `close` event. A test runner that traps the signal
  to print its summary, or a process wedged in an uninterruptible read, never
  emits one — so the run stopped mid-task with no error, no output and nothing
  to report.
- **POSIX now escalates.** `SIGTERM`, a grace period, then `SIGKILL`, which
  cannot be trapped. The grace is long enough for a runner to flush and a build
  to clean up its temporary directory.
- **Windows takes the tree.** It has no graceful signal, so a grace period there
  would be theatre; what it lacked was the children. `TerminateProcess` killed
  the wrapper and left the actual work running, still holding the port or the
  lock the next command needed.
- **Every step is scheduled up front**, not armed by the failure of the one
  before it. The case that hangs produces no event to react to, so a design that
  waits for one cannot recover from it.
- **The receipt says whether a process had to be killed.** A command that
  ignored termination usually leaves something behind, and the next command is
  the one that trips over it.
- A `taskkill` that fails because the process already exited is ignored rather
  than turned into a spurious command failure.

## 1.40.0

Minor: git can say whether a branch could open a pull request (F103, narrowed).

- **Twenty-five git operations shipped and none of them was about a pull
  request.** An agent asked to open one found out what was wrong by trying: it
  pushed, failed, and spent model turns learning that the repository had no
  remote or that it was sitting on the base branch. Every one of those facts was
  already in git.
- **`pr-readiness` answers instead of running.** It is the one git operation that
  asks a question about the repository rather than changing or printing it, so
  the receipt carries an assessment alongside the usual before and after hashes.
- **Blockers come back ordered, not as a set.** They are not independent. Adding
  a remote is pointless while you are on the base branch, and pushing is
  pointless while there is nothing to push. A caller handed five problems fixes
  them in the wrong order; a caller handed the first one fixes the thing that
  unblocks the rest.
- **Being behind the base is a warning, not a blocker.** A behind branch still
  merges, and refusing it would refuse most real pull requests.
- **A failed read is the absence of the thing, not an error.** Counting commits
  against a base that does not exist locally fails, and the honest reading is
  "nothing is ahead of a base I cannot see" rather than a git error handed to the
  model to interpret.
- **A ready branch says so.** Returning an empty summary for the healthy case
  would make the answer the caller most wants indistinguishable from a check that
  never ran.
- **Classified as a read everywhere it is classified.** It carries R0 risk and
  sub-agents may call it, because it mutates nothing.
- **Narrowed:** creating the pull request is a GitHub API call that lives in
  workspace-service, and PR-to-session resumption exists nowhere. The audit row
  stays PARTIAL and says which half shipped.

## 1.39.0

Minor: cached prompt tokens are counted as cached (F093, narrowed).

- **The backend has reported `cachedPromptTokens` since prompt caching was
  billed, and nothing here read it.** A conversation served almost entirely from
  cache counted every cached token at full price, in the meter people use to
  decide when to compact.
- **Cached is a subset of input, never an addition to it**, and the distinction
  is load-bearing in both directions. Cached tokens cost a fraction of fresh
  ones, so counting them at full price makes a cheap conversation look
  expensive. They still occupy the context window, so subtracting them from the
  total would make a conversation about to overflow look like it has room. Cheap
  is not the same as free of context.
- **The share appears in the tooltip, not the label.** It says what a request
  cost, not how much of the window it used, and the label is read as a capacity
  number.
- **A provider claiming more cached tokens than prompt tokens is clamped.** That
  is a report this cannot represent, and believing it would show a cache share
  above one hundred per cent.
- An estimate never claims a cache hit, because an estimate cannot have observed
  one.

## 1.38.0

Minor: run spans can reach an OTLP collector (F108, narrowed).

- **`setRemoteExport` finally has a caller.** It has existed since remote
  telemetry was designed and had none: spans terminated in the VS Code output
  channel. `clawAI.telemetryEndpoint` is the sink it was waiting for.
- **Configuring an endpoint is the approval.** There is no default collector to
  opt out of, because telemetry that turns itself on is the thing people rightly
  object to. Empty means nothing leaves the machine.
- **HTTPS everywhere except loopback**, and that exception is the point rather
  than a hole: a collector on the developer's own machine has no certificate,
  and one anywhere else is reached across a network that will read a plaintext
  bearer token out of the headers. Credentials in the URL are refused outright.
- **Span attributes are redacted before export.** Spans carry tool arguments,
  paths and command lines, which is exactly where a secret ends up. A sink that
  writes to an output channel and one that posts to a vendor have different
  stakes, so the redaction lives at the boundary that leaves the machine.
- **A collector being down never fails a run.** Failures are swallowed after one
  log line, the queue drops its oldest spans past a small cap so an outage
  cannot become a memory leak, and every export is bounded by a timeout.
- **Written by hand, not by adding the OpenTelemetry SDK.** The JSON encoding is
  a published, stable shape; the SDK would bring a tracer, a context manager and
  an async-hooks dependency into a host that already has its own span model.
- Metrics are not exported, and the code says so rather than emitting spans
  shaped like metrics. A dashboard that looks right and counts nothing is worse
  than an empty one.

## 1.37.0

Minor: read what security scanners produce (F106, narrowed).

- **`workspace.scan` imports a SARIF report and records it as findings.** The
  audit found zero CWE, CVE or SARIF references anywhere: the secret regexes are
  leak prevention, and the workspace audit is a prompt.
- **ClawAI does not become a scanner.** Shipping a vulnerability database inside
  a VS Code extension is stale the day it ships and duplicates what the
  project's pipeline already runs. Reading SARIF is the right shape, because
  every scanner worth using already emits it.
- **The score beats the word.** A scanner has three useful levels and hundreds
  of rules; `security-severity` is the CVSS-style number the same scanners emit
  beside it. Reading the number first is what stops an injection rule and a
  style rule arriving as the same "error".
- **Everything imported is medium confidence, never high.** A scanner reports
  what its rule matched, not whether it matters here, and importing at high
  confidence would rank machine output above a reviewer who read the code.
- **A result that cannot be placed in the workspace is dropped**, not reported
  at a guessed path. A finding pointing at the wrong file is worse than one that
  never arrived: the reader opens it, sees nothing, and stops trusting the list.
- **CWE tags are kept**, because they are the one part of a finding that
  survives changing scanners. Results go through the same recorder a reviewer's
  own report uses, so a scanner result and a human finding about the same line
  become one entry rather than two competing ones.
- Both counts are reported. A large gap between found and recorded means the
  report was produced against a different tree.

## 1.36.0

Minor: drop files from the editor or the explorer (F037, narrowed).

- **Dropping a file from the file tree used to do nothing at all.** The composer
  accepted only drags carrying real file data, and a drag from the editor or the
  explorer carries references instead. The drop was never allowed, so it never
  arrived — which reads as a broken feature rather than an absent one.
- **Shift is the difference between naming a file and reading it.** A plain drop
  mentions the file, which pulls its contents into the next request; Shift
  inserts the path as text, which is what you want when the path is the subject
  rather than the content. Getting that backwards would make the cheap gesture
  the expensive one.
- **The panel forwards the drag and the host resolves it.** Only the host knows
  the workspace root, and only the host owns the policy deciding whether a
  dropped path may be read at all.
- **Everything outside the open folder is refused, and so is every scheme that
  is not a file.** An editor drag can carry `untitled:` and `https:` URIs, and a
  mention resolved from one of those reads nothing while looking like it worked.
  A sibling folder sharing a name prefix is refused too.
- A refusal is said out loud. Dragging a file from outside the folder is a
  reasonable thing to try, and silence would leave someone dragging it again.
- Mentions are written in the syntax the composer already parses, so a dropped
  file and a typed reference reach the same place.

## 1.35.0

Minor: the host says what isolation it can actually give (F051, narrowed).

- **A sandbox capability probe, reported in the diagnostic report.** The
  extension bounds commands — no shell, no chaining, capped output and wall
  clock — but bounding is not isolation, and nothing said so.
- **Saying "none" out loud is the honest half of the feature.** A run that
  reported "sandboxed" on a host with no sandbox would be lying in the one place
  a reader is deciding whether to approve something.
- **Each guarantee is stated separately**, not rolled into one boolean. A jail
  that isolates the filesystem and not the network is a different promise from
  one that does both, and a caller told only "yes" cannot tell which they got.
- **Windows job objects are named rather than counted as a sandbox.** They
  contain a command and its children and do not jail the filesystem or block the
  network, so "contained but not jailed" is what the report says.
- **A helper on PATH is evidence, not proof.** A container can have `bwrap` and
  lack the capabilities to use it, so the probe reports what a host has a
  mechanism for and leaves the caller to probe before relying on it.
- Probed once per session, because the answer cannot change while the process
  runs and a probe per command would cost more than the isolation saves.

## 1.34.0

Minor: agent graphs can be saved and re-run (F011, narrowed).

- **`runtime.workflows` saves an agent-built graph to `.clawai/workflows` and
  loads it back.** Workflows were seven prompt templates behind a command:
  fixed, written by this repository, and unable to describe the work anyone
  actually did twice. A graph the model built and a person watched succeed is a
  better workflow than any template, and until now it could not be kept.
- **Loading refreshes the epochs; it never replays the stored ones.** An epoch
  names the generation of account, workspace, target and policy a call was
  authorised against. Replaying a saved epoch would run today's work against an
  authorisation nobody re-granted, and the check would pass because the number
  matches. A saved workflow is a shape to re-run, never a permission to reuse.
- **The stored file carries zeroed epochs**, so it does not look like an
  authorisation record to anyone reading it.
- **The file name is a slug, not the name.** A workflow name is written by a
  model, and a name containing `..` is a path traversal wearing a label.
- **Every file is parsed through the schema on read.** A workflow lives in the
  workspace where anyone can edit it, and a graph that skipped validation
  because it came from disk would be the one path into the runtime that never
  checked its input. A malformed file is skipped rather than failing the
  listing.
- They live in the repository rather than extension storage, because a workflow
  describes how this project is worked on and should travel with the code it was
  written against.

## 1.33.0

Minor: goal mode for an ordinary run (F014, narrowed).

- **`runtime.goal` states what a run is for and how anyone will know it
  worked.** An ordinary run had no completion condition: it ended when the model
  decided it was finished, and "finished" was a sentence in a summary rather
  than anything a reader could check. The flagship lane has had acceptance
  checks since it existed, behind five fixed strategies and ten fixed stages.
  This is the same idea without them.
- **`runtime.end` refuses to complete while a check is open**, and names which.
  Abandoning is always allowed: refusing to let a run give up would trap it
  against a goal it has already decided it cannot meet, and the terminal record
  says which it was.
- **Redeclaring over a goal with open checks is refused.** A model that could
  replace its own checks could clear every one by declaring a shorter list,
  which turns the mechanism into a formality it satisfies by rewriting the test.
- **A waiver needs a real reason.** Without a floor, "n/a" clears any check. The
  floor does not make a reason good; it makes an empty one visible.
- **At most twelve checks.** Acceptance checks only work while a reader can hold
  all of them in mind at once. Beyond about a dozen the list stops being a test
  and becomes a document.
- A run that declares no goal ends exactly as it did before.

## 1.32.0

Minor: a shared note board for agents in a graph (F009, narrowed).

- **`runtime.board` lets agents in one graph tell each other things.** Steering
  was parent to child only: a coordinator could tell an agent something, and an
  agent could tell nobody. Two agents editing adjacent code could not warn each
  other, and the only way one learned what another found was for both to finish
  and the parent to read both reports.
- **The caller's identity comes from the task being run, never from the
  arguments.** An agent that could name itself could post as another, and a
  warning attributed to the security reviewer carries weight the poster did not
  earn.
- **A per-agent quota, not just a total.** One chatty explorer posting two
  hundred notes would push every other agent's work off the board, and the
  agents that lost their notes would have no way to tell.
- **A refusal names the limit that stopped it.** "Your quota is full" and "the
  board is full" call for different responses, and an agent told only "no" will
  retry the same note.
- **Reading leaves out your own notes** and takes a sequence you have already
  seen, so checking the board repeatedly costs almost nothing and never spends
  context on what you wrote.
- Notes are redacted on the way in, since an agent quoting a config file is the
  ordinary case. A duplicate is refused rather than appended: two agents
  reaching the same conclusion is worth knowing once.
- The board is per graph and is cleared with the run-scoped stores, so a second
  graph never reads the first one's notes.

## 1.31.0

Minor: sub-agents can inherit what the parent already knows (F008).

- **A task may now declare `inherit`.** Sub-agents received a goal, a write set
  and a worktree, and nothing about why they were asked. A reviewer would
  re-report a finding the parent had already recorded; an implementer would
  rediscover a decision the parent made an hour earlier and quietly make the
  opposite one.
- **Two modes, because they answer different needs.** `summary` says what the
  parent is doing, what it has settled and which files it already changed, which
  is what an implementer needs. `findings` adds what has already been reported,
  which is what a reviewer needs and an implementer mostly does not.
- **`none` is the default and is exactly the old behaviour.** Widening what a
  delegated agent sees is a scope change, and a scope change that happens by
  upgrading is one nobody approved.
- **Redacted before it is bounded, never after.** Redaction shortens text, so
  bounding first would cut at a position that shifts once secrets are removed,
  and a secret could survive by sitting just past a boundary that later moved.
- **Bounded to sixteen kilobytes and cut on a line boundary.** Inheritance is
  meant to stop a child rediscovering what the parent knows, not to hand it the
  parent's whole run: a child spending a quarter of its budget reading history
  has been helped into failing.
- Inherited context is placed before the goal, because a model reads the goal as
  its instruction and anything after it competes with the instruction.

## 1.30.0

Minor: a monitor tool the run can wait on (F012).

- **`runtime.monitor` waits for one workspace file to reach a state.** It can
  wait for a file to appear, to vanish, to change, or for its text to match a
  pattern. Before this, a run that started a build had two options: read the
  output file immediately and find it absent, or spend model turns re-reading
  it. Both spend the budget on the same question.
- **Every wait is bounded twice**, by the caller's timeout and by a ten-minute
  ceiling the caller cannot raise. The budget that would otherwise stop a run
  counts model turns, not wall clock, so a watcher with no ceiling is a run that
  never ends.
- **A timeout returns, it does not throw.** "The condition held" and "time ran
  out" are different facts, and a timeout reported as an error would make the
  model treat a slow build as a broken one.
- **Polling backs off from a quarter second to five.** A file a command is about
  to write is noticed within a second; a ten-minute wait costs about a hundred
  and thirty looks instead of two thousand four hundred.
- **`changed` compares against the state when the wait began**, not against the
  previous look. A file written twice while nobody was looking has still
  changed, and comparing consecutive polls would miss the second write landing
  between them.
- A bad pattern is refused before anything starts waiting, where the caller can
  be told what was wrong with it.

## 1.29.0

Minor: the browser tool can be pointed at your own sites (F036, narrowed).

- **`clawAI.browserOrigins` adds site origins the browser may open without
  asking.** The allow list was the backend and frontend this extension signs in
  to, and nothing else — not your dev server, not your staging site, not the
  documentation you are working from. Each of those was reachable only by
  approving an external navigation one prompt at a time, which is the shape of a
  permission people click through without reading.
- **Loopback and private addresses are allowed here, and refused by the web
  tool.** The difference is who chose the address. `workspace.web` follows URLs
  a model picked, so a loopback URL there is the classic way to reach a metadata
  service nobody meant to expose. This list is written by the user, naming a
  server they are running.
- **A URL carrying credentials is refused.** A password in a settings file is a
  password in a backup, a screen share and a bug report.
- **The built-in origins cannot be removed by configuration**, only added to. A
  setting that could subtract the backend origin would let a workspace file
  break sign in.
- Entries are reduced to origins, so a path or a query cannot smuggle in more
  than a site, and a bad entry is skipped rather than failing the whole list.

## 1.28.0

Minor: an advisor model (F090, narrowed).

- **`runtime.advisor` asks a different model one question.** Delegation already
  existed: a sub-agent can be given work. What did not exist was consultation —
  asking mid-run whether a conclusion holds, without handing over the task or
  the workspace.
- **It is never the model already running.** Asking the same model the same
  question in the same conversation is not a second opinion; it is the same
  opinion restated with more confidence, and a run that treats that as
  corroboration is worse off than one that never asked.
- **The advisor gets the question and the asker's own summary, and nothing
  else.** No tools, no root key, no sight of the conversation. The worst a bad
  advisor can do is give bad advice, which the run is free to reject. A
  consultant with the workspace would be a second agent nobody scoped.
- **Advice is labelled as advice.** The reply carries the advisor's name and
  `binding: false`, because a second opinion whose source is not recorded cannot
  be weighed later, and one that reads like a verdict gets followed for the
  wrong reason.
- **One model on the account is reported, not failed.** That is a fact about the
  account rather than a fault in the call, and a run that failed here would be
  failing for asking a reasonable question.
- Each consultation gets its own thread, so one question's answer cannot colour
  the next and no second model's words land in the transcript the user is
  reading as their own agent's.

## 1.27.0

Minor: Fast mode (F089 complete).

- **`ClawAI: Toggle Fast Mode`** asks for a quick reply on both levers that
  exist: the backend router prefers a low-latency model, and the extension
  gathers workspace context with eight metadata lookups in flight instead of
  one.
- **They are genuinely two different mechanisms and the docs say so.** One is a
  model choice made on a server; the other is local syscall concurrency. They
  belong behind one control because a person asking for a fast reply is not
  asking about either mechanism — they want the whole round trip shorter, and
  moving one lever buys half of it.
- **Neither lever trades correctness.** The router still picks a capable model,
  and `2X` changes only how many stats are in flight. The file set, the byte
  budget, the inclusion order, approvals, writes and commands are untouched.
- **The toggle reports on only when both levers are where it put them.** A
  half-match would light it for someone who chose low-latency routing
  themselves, and turning it off would then change a setting they did choose.
- **It puts back exactly what it replaced, then forgets it.** A stale memory is
  worse than none: turning Fast mode on next week and off again would restore a
  routing mode chosen for a task nobody remembers.
- This was unreachable until 1.24.0, which is when `LOW_LATENCY` stopped being a
  backend-only mode.

## 1.26.0

Minor: stale referenced ranges are marked (F033 complete).

- **A `path:L-L` reference is a snapshot, not a live view.** Edit the file
  afterwards and the same line numbers point at different code, so the receipt
  claims the model read something it never saw. Nothing errors, and the
  conversation reads as though it were still about the current file. That is the
  quiet kind of wrong.
- **The receipt now records a digest of exactly what was collected** — the
  range, not the whole file, because the range is what the reference names.
- **The check runs on save.** A save is the only moment the answer can change,
  and it is the moment someone is looking, so the mark appears while they still
  remember making the edit. A save of a file the receipt does not name reads
  nothing.
- **Changed and gone are separate answers**, because they need different ones. A
  changed range can be re-collected by sending again; a deleted one cannot, and
  telling someone to refresh a file that is gone wastes their time.
- **A receipt taken before digests existed reports fresh.** Calling a file
  changed on the strength of a missing record would make every old receipt look
  wrong at once.
- Nothing re-collects behind your back. The view reports; the next message is
  still yours to send.

## 1.25.0

Minor: automatic compaction (F041 complete).

- **`shouldCompact` has been able to say "this conversation is nearly full"
  since 1.12.0 and nothing ever asked it.** Now something does. The new
  `clawAI.autoCompact` setting chooses between doing nothing, offering to
  summarize, and summarizing automatically. It defaults to offering, which is
  the only choice that cannot surprise anybody.
- **The panel reports the number, the host decides what it means.** The running
  token total for a conversation is known only to the panel, so it sends it. The
  capacity is not sent with it: that is a reading of the model catalog and the
  routing mode, both of which the host owns, and a number the host can derive is
  one it should not accept from elsewhere.
- **Nothing happens while a run is in flight.** Compaction continues the
  conversation in a new thread, so starting one while a run writes into the old
  thread splits the record and half the answer lands where nobody will look.
- **A conversation is raised once, not on every render.** It stays nearly full
  until something is done about it, and the state subscription fires constantly.
  The flag clears when usage falls back, so a later fill asks again.
- **An unknown capacity never triggers.** Compaction throws away detail, and
  doing that on a guess is worse than letting the server drop the oldest
  messages, which at least happens for a measured reason.
- The automatic mode reuses the manual command verbatim and only skips its
  question. A compaction that behaved differently when the extension started it
  would be a second feature wearing the first one's name.

## 1.24.0

Minor: all seven routing strategies, and a warning when the model cannot run
the agent (F088, narrowed).

- **Five routing strategies the backend has always offered are now reachable.**
  Local models only, privacy first, fastest reply, strongest reasoning and
  lowest cost were never missing from the backend; they were unreachable from
  here. Someone who wanted local-only routing had to pick a model by hand and
  keep picking, which is the manual mode wearing a different hat.
- **The code now asks whether the router chooses, not whether the mode is
  `AUTO`.** That comparison was correct while there were two modes and silently
  wrong the moment there were seven, in a direction nothing would report: a
  cost-saver run treated as manual looks for a model key that mode never sets.
- **Switching to a strategy clears the stored model.** Leaving a stale key
  behind means the next change reads a model nobody chose under that strategy,
  and a local-only run resuming a cloud model is the surprise the mode exists to
  avoid.
- **The panel says when the selected model cannot call tools.** The catalog has
  carried `supportsTools` from four backend shapes all along and nothing read
  it. An agent run on a model without tools is not a slower run: it reads
  nothing, writes nothing, and spends its whole budget describing work it never
  did.
- Only an explicit `false` warns. A model the catalog has not caught up with is
  assumed capable, because absence of a capability flag is not evidence of
  absence, and a router-selected mode never warns at all.

## 1.23.0

Minor: multiline search and language scoping (F003, narrowed further).

- **`multiline: true`** runs a pattern across line breaks and reports the line
  the span starts on, which is the line a reader would open. The preview is the
  matched span rather than its first line: a pattern written to span lines is
  asking about the span, and showing one line of it hides what was found.
- **`fileTypes: ["ts"]`** scopes a search by language or by bare extension.
  Extensions are the part nobody remembers, and a glob written from memory
  searches fewer files than the writer thinks, which reads as absence.
- **An unknown type name is refused, not ignored.** Ignoring it would narrow the
  search to nothing and answer "no matches", and a search that reports absence
  without having looked is the one failure that cannot be caught downstream.
- **Types filter the results, not the glob.** The caller's pattern is arbitrary,
  and rewriting it to carry extensions is how a search quietly stops matching
  what was asked for.
- Multiline scanning is bounded per file and per match count. A per-line search
  is bounded by the line; a spanning pattern has no such ceiling, and a nested
  quantifier over minified source is the input that turns a search into a hang.
- Both arguments are named in the tool description, which stayed inside its
  1,600-character budget by shortening, because a capability the description
  omits is one no model ever uses.

## 1.22.0

Minor: a Needs You view with a badge (F102, narrowed).

- **A run that stalls on an unclicked approval now says so outside the panel.**
  The approval lives in the chat panel, so a reader looking at a source file got
  no signal at all, and an unattended run could sit blocked indefinitely. The
  new view lists what is waiting, and the activity-bar badge is the part that
  reaches someone who is not looking at ClawAI.
- **Ordered by what it costs to leave alone.** An approval or a question has
  stopped a run and nothing will restart it; a failed run has already happened;
  a queued run is merely waiting its turn. Listing them in any other order
  buries the one that costs something.
- **The badge counts only what has actually stopped.** Queued and long-running
  work appears in the list but not in the badge, because a badge lit through
  every ordinary busy period says nothing.
- **A long-running run is listed, not flagged.** Five minutes of reading a large
  repository is work, not a failure. The point is that a reader who walked away
  cannot otherwise tell that apart from a run that will never finish.
- Every row opens the panel, because an attention list whose rows do not act on
  what they name is a second place to read the same bad news.

## 1.21.0

Minor: a run terminal (F069, narrowed).

- **`ClawAI: Open Run Terminal`** opens a pseudoterminal where a request is
  typed and the run reports back as phases, files and commands, the way a build
  log does. The panel remains the right home for an answer with code in it; a
  run is a different shape and belongs where run logs go.
- **Nothing about the run pipeline changed to support it.** The terminal
  subscribes to the same run snapshots the panel does and prints what changed,
  so the two surfaces cannot disagree about what a run did. Only the difference
  is printed, so an idle subscription stays silent.
- **Everything the model contributes is stripped of control sequences first.** A
  pseudoterminal renders whatever it is handed. A summary written straight from
  the wire could clear the scrollback, rewrite the window title, or turn a word
  into a hyperlink pointing anywhere, and a repository the agent read can put
  any of that in the model's mouth.
- **Backspace is stripped for the same reason** — it lets a model overprint what
  it already wrote, so the terminal would show something other than what was
  sent.
- **The line editor states every rule a shell gives for free**: what echoes,
  what erases, what submits, what closes. Arrow keys are dropped whole rather
  than echoed, because a terminal showing `^[[A` where the reader expected their
  last line is worse than one that does nothing.
- A second request while a run is going is refused rather than queued silently,
  because a reader watching a run that is not the one they just asked for has no
  way to tell.

## 1.20.0

Minor: the model's private reasoning stays on the host (F043, narrowed).

- **A reasoning delta is stripped before it leaves the extension host.** Every
  stream event goes through one door on its way to the panel, and that door now
  drops the chain-of-thought text and forwards only its size. The panel has
  always shown a token count and nothing else, but the text itself still crossed
  the boundary and sat in the webview's message queue, where anything inspecting
  the webview could read it. Counting in the panel was a convention; dropping the
  text on the host is an invariant.
- **Three field names, not one.** `delta` is what the backend sends today;
  `content` and `reasoning` are the shapes the same event takes on providers that
  report a whole reasoning block, so a future backend that starts forwarding one
  cannot slip past the guard.
- **The reasoning row is a disclosure, not a line.** Extended thinking can run
  for minutes, and a flat list item that only grows a number gives no way to tell
  a long think from a stalled request. The summary carries the step count and the
  size; opening it says why there is no text to read.
- An event that arrives without a usable size still counts as a step. The model
  demonstrably thought, and reporting nothing would be a worse answer than
  reporting a step worth zero tokens.

## 1.19.0

Minor: domain rules in the project policy (F053, narrowed).

- **`domainGlob` joins `pathGlob` and `commandGlob`** in
  `.clawai/policies/policy.json`, so a repository can refuse or gate the hosts
  the agent may reach.
- **It matches the host, not the URL.** A rule about where a request may go is
  about the site; matching a whole URL would let a path fragment satisfy a rule
  meant to be about the origin. `https://evil.test/#docs.trusted.test` yields
  `evil.test`, because the host comes from the URL parser rather than a
  pattern.
- **A call that names no host can never match a domain rule** — a rule about
  network access says nothing about a file read.
- Still tighten-only, like every project rule: there is no `allow` outcome, so
  a cloned repository can only refuse work, never grant itself permission.

## 1.18.0

Minor: named checkpoints (F057).

- **ClawAI: Create Checkpoint** remembers the current contents of every file
  the agent has changed this session, under a name you choose.
- **ClawAI: Restore Checkpoint** puts them back — through the ordinary file
  transaction, so the restore is previewed, approved and itself undoable. A
  restore that could not be undone would make the safety feature the most
  dangerous button in the extension.
- **Only files the agent touched.** A checkpoint of the whole workspace would
  be a backup tool, which this is not and should not become.
- **Ten checkpoints are kept**, oldest dropped first, because a checkpoint
  holds file contents and an unbounded list of them is a workspace-sized leak.
- **An entry that no longer parses is dropped, not repaired.** A checkpoint is
  a promise to put files back exactly as they were; a half-read one cannot keep
  that promise.

## 1.17.0

Minor: side questions (F042).

- **ClawAI: Ask a Side Question** answers something without adding it to the
  conversation. The question goes to a separate thread and the answer opens as
  a document, not a message.
- **The thread is archived at creation**, so it never appears in your history —
  a thread visible for even a moment has already polluted the list you were
  keeping clean. One thread is reused for the session rather than one per
  question.
- **It carries none of the conversation's context, on purpose.** There is no
  way to give it that context without writing into the thread, which is the
  thing being avoided — so the question is asked clean and the answer says so
  at the bottom.

## 1.16.0

Minor: cell-granular notebook editing (F018).

- **`workspace.notebook`** reads a notebook's cells and inserts, replaces or
  deletes exactly one — instead of rewriting the whole `.ipynb` as opaque text
  and destroying its structure.
- **Everything the editor has no opinion about survives**: outputs, execution
  counts, per-cell metadata, kernelspec, widget state. Parsing into a narrow
  shape and writing it back is how a notebook gets destroyed by a tool that
  meant well.
- **The file is written back the way it was found** — same indentation, same
  source representation per cell. A notebook reformatted from two spaces to
  four is a diff nobody asked for.
- **Changing a cell's code clears its outputs.** An output that no longer
  corresponds to the code above it is worse than no output.
- **An index outside the notebook is refused, not clamped.** "Edit cell 12" in
  a nine-cell notebook silently editing cell nine is not help.
- Edits go through the same preview, approval and undo as every other file
  change, because a notebook edit is a file edit.

## 1.15.0

Minor: reference a terminal you are already using (F035), and a redaction fix.

- **ClawAI: Attach Terminal Output** puts the last command from a terminal, and
  what it printed, into the composer — tagged as terminal output, not pasted as
  prose. A build log that happens to contain "ignore previous instructions" is
  still a build log.
- **It goes into the composer, not into a message.** Attaching output is
  gathering evidence, not asking a question; sending it for you would decide
  what the question was.
- **The end of the output is kept, not the start.** A build that scrolled for
  two thousand lines is being referenced because of how it ended.
- **Only commands VS Code saw start can be read.** Shell integration is the
  only supported way to read a terminal, so a terminal without it is named and
  said to be unreadable rather than attached empty.
- **Security fix: `GITHUB_TOKEN=…` was not being redacted anywhere.** A word
  boundary does not sit between an underscore and a letter, so every
  underscore-prefixed secret name slipped through — in logs, diagnostics and
  feedback reports, not only terminals. Underscore-joined names now match, and
  `SECRETARY_NAME=Alice` still does not.

## 1.14.0

Minor: conversation groups (F062).

- **ClawAI: Group Conversation** files a conversation into a group, creates a
  new group, or takes it out of one — all from the same question, because
  "which group is this in" has an answer that includes none.
- **The history view shows groups as folders**, expanded by default: a group
  somebody made is a group they want to see into.
- **Groups sort alphabetically, not by recency**, so a group does not move
  because somebody replied in it. A list that reorders itself is a list you
  have to re-read.
- **Assignments are stored on this machine**, workspace-scoped. The server has
  no notion of a group, and inventing one client-side that looked shared would
  be a lie the first time you opened the same account elsewhere.
- Assignments for deleted conversations are pruned on every write.

## 1.13.0

Minor: open a conversation in a second window (F065).

- **ClawAI: Open Conversation in New Window** opens the same folder in a new
  VS Code window and reveals the conversation there. A webview panel cannot
  move between windows, so nothing is moved — two windows on one folder is what
  you actually want, the conversation beside a different set of files.
- **The handoff expires after a minute.** A note left by a window that never
  opened, or a cancelled folder prompt, must not hijack the next window you
  open for something else.
- **The note is cleared before the conversation opens**, not after, so a
  failure cannot leave it behind for the window after that.
- Refuses without a folder rather than opening an empty window, where a chat
  could read nothing.

## 1.12.0

Minor: manual conversation compaction (F041, partly).

- **ClawAI: Compact Conversation** asks the conversation's own model to
  summarize it, then continues in a new conversation seeded with that summary.
- **Nothing is destroyed.** The original thread keeps every word and stays in
  your history. Compaction that rewrote what it compacted would be a feature
  people are afraid to use.
- **The summary is asked for in the thread being summarized**, by the model
  that was already there. A different model would be summarizing a
  conversation it never saw; a hidden side thread would conceal what was
  written on your behalf.
- **The summary asks for decisions, not prose** — goal, decisions and why, work
  done, work outstanding, open questions, files and paths. A summary optimised
  for reading loses exactly what the next turn needs.
- An empty summary changes nothing and says so.

## 1.11.0

Minor: a reserved response budget and a truncation warning before you send
(F040).

- **A context window is not a budget for the prompt alone.** Whatever the model
  says has to fit in the same window, so a quarter is kept back — bounded at
  1 024 and 32 000, because the fraction that matters is small windows.
- **The composer warns while you can still act on it.** "Nearly out of room"
  fires while this message still fits and the next one will not, which is the
  moment a person can do something cheaply. A meter that only speaks after the
  loss is a receipt.
- **It says nothing it cannot know.** Automatic routing has not chosen a model,
  and a model may report no window; warning about a limit nobody knows is a
  warning nobody can act on.

## 1.10.0

Minor: images are stripped, gated and budgeted before they are sent (F039).

- **EXIF is removed from JPEGs and text chunks from PNGs**, on this machine,
  before upload. A screenshot is usually harmless; a phone photo carries GPS
  coordinates, a device serial and a timestamp, and attaching one would send
  all three to a model provider. Nobody means to do that, so it is not an
  option — it just happens.
- **Segment surgery, not re-encoding.** The scan data is copied through
  untouched, so the picture is byte-for-byte what you attached minus the parts
  that describe you.
- **A model that cannot see is not sent an image.** The attachment is dropped
  with a reason rather than the request failing at the provider.
- **Images are budgeted per request**, and the one that would overrun is the
  one refused — not the ones before it.
- **One unusable attachment costs you that attachment**, never the message you
  were writing.

## 1.9.0

Minor: lifecycle hooks (F078).

- **`clawAI.hooks` runs your commands** at four moments: `run-start`,
  `run-end`, `before-tool` and `after-tool`, optionally narrowed to a tool by
  glob.
- **Hooks live in VS Code settings, never in `.clawai`.** That is the whole
  security design: a hook runs a command, and reading one from workspace
  content would make cloning a repository enough to execute code. Project
  configuration here may only ever tighten — `policy.json` has no `allow`
  outcome for the same reason — and a hook is the opposite of a tightening.
- **Only a `before-tool` hook marked `blocking` can stop a call.** Everything
  else is advisory, so a broken hook slows a run rather than halting it.
- **A hook that hangs is silence, not refusal.** Treating a timeout as a block
  would let one wedged script stop every run on the machine.
- **Hooks run after the policy has allowed a call**, never instead of it. A
  hook must not become a way to reach something policy refused.
- No shell: a hook is a command and its arguments, so a semicolon in a setting
  cannot become a second command.

## 1.8.0

Minor: output styles (F082).

- **ClawAI: Select Output Style** chooses how answers are written: default,
  concise, explanatory, or learning.
- **A workspace can define its own.** `.clawai/output-styles/*.md` are read by
  the same parser skills use — a style and a skill are the same kind of thing,
  a named block of instruction in a file, and two readers for one format would
  drift apart. A project style replaces a built-in of the same name.
- **One place assembles the prompt now.** The Plan-mode instruction and the
  style were being applied on two different send paths; a prompt assembled
  differently by each is a prompt whose behaviour depends on which transport
  was selected.
- **Plan mode comes first, style second.** The first is a constraint on what
  may happen, the second a preference about how to say it — so a style that
  could read as loosening the constraint is already overruled by the time it
  is read.
- Style preambles stay in English because the model reads them; only the
  picker labels are translated.

## 1.7.1

Patch: the translation block fills gaps instead of overriding, and `npm run
check` now verifies generated localization.

- **1.6.0's new translations were consulted first** and silently replaced
  existing ones — Chinese `view.chat` went from 聊天 to 对话 and Thai from แชต to
  แชท. A block whose job is to fill gaps is now consulted last, so it can only
  add.
- **The regenerated `package.nls.*.json` files were left uncommitted**, which
  CI caught and `npm run check` could not: freshness was a CI-only step.
  `l10n:verify` is now part of `check`, so the gate that runs before every
  commit checks the same thing CI does.

## 1.7.0

Minor: skills are slash commands now (F077).

- **Every `.clawai/skills/*.md` file is invocable.** `review.md` becomes
  `/review`, typed at the start of a message. A `skills` directory in the VS
  Code profile's global storage works the same way, and a project skill of the
  same name wins.
- **Type `/` in the composer** and the same list that completes `@` mentions
  offers commands. Matching is by prefix, not subsequence: a command is a name
  someone chose, and offering `deploy` for `dp` would put a destructive command
  one Enter away from a typo.
- **Arguments substitute.** `$ARGUMENTS` takes everything after the command,
  `$1`…`$9` take one word each, and a body with no placeholder gets the
  arguments appended rather than dropping them.
- **An optional header** sets `name`, `description` and `argument-hint`, read
  by a three-field parser rather than a YAML library — this is workspace
  content, and a malformed header costs the header, not the skill.
- **An unknown command is sent as ordinary text**, never refused: a message
  beginning with a slash has to stay sendable.

## 1.6.0

Minor: a translation ratchet, and the first twenty strings paid off.

- **A new user-facing string must now be translated to land.** The locale
  generator falls through to the English source for anything it has no entry
  for, so every bundle was always complete and never said which entries were
  real. CI checked only that bundles were fresh, never that they were
  translated.
- **`l10n/untranslated-baseline.json` is the ledger** of what is still English
  in at least one locale. The test fails on anything untranslated that is not
  in it, refuses entries that are now translated, and refuses entries for
  messages that no longer exist — so the list can only shrink.
- **Twenty high-traffic strings translated**, taking the ledger from 326 to 309. Strings that are legitimately identical in a language stay listed rather
  than being guessed at: no rule can tell a real match from a fallback.

## 1.5.0

Minor: a status line that says what the agent is doing, and shortcuts for the
commands that need them (F084).

- **The status line reports activity, not just connection.** Waiting for you,
  running, running with N queued, N queued, or idle — and the model the next
  prompt will use.
- **Something waiting on you outranks work in flight.** A status line that said
  "busy" while a question sat unanswered would be telling you to wait for
  yourself, so that state gets the one colour the status bar has for "look
  here".
- **Automatic routing is reported as automatic**, never resolved to whichever
  model it happened to pick last time — naming one would promise the next
  request goes to the same place, which is the one thing routing does not
  promise.
- **Nine more commands have shortcuts**, including stopping a run, which is the
  one that cannot wait for a palette search. Editor-scoped shortcuts are guarded
  on editor focus so they do not fire from the chat.

## 1.4.0

Minor: per-turn semantics and keyboard navigation of the transcript (F070).

- **Every turn is an `article` with a label** saying who spoke and which turn
  it is out of how many, renumbered as the conversation grows or a dropped
  request removes one.
- **Alt+Up and Alt+Down step between turns.** From nowhere, Alt+Up means the
  most recent turn — a reader who has not entered the transcript and presses
  "previous" means the newest thing said, not the oldest.
- **Either end stops rather than wrapping.** Wrapping is fine in a menu of
  five items; in a conversation it silently teleports the reader from the
  newest message to the oldest, and a screen-reader user has no peripheral
  vision to notice.
- Each move is announced, so the position is spoken rather than implied.

## 1.3.0

Minor: a Getting Started checklist that knows where you actually are (F071).

- **Four steps in the order they depend on each other**: sign in, open a
  folder, trust it, load the model catalog. A model cannot be chosen before an
  account is known, and rules cannot be written into a folder that is not open.
- **Every step is derived from live state**, not a flag set once. Sign out or
  revoke trust and that step goes back to undone, because a checklist that says
  "done" about something no longer true is worse than no checklist.
- **The view hides itself once setup is finished** and comes back on its own if
  something is undone. A checklist that stays after it is finished is a
  permanent reminder of nothing.
- The next step is labelled, because the earliest gap is the only one you can
  close right now.

## 1.2.0

Minor: the agent can search the web and read a page (F004, F005).

- **`workspace.web` has two operations.** `search` returns ranked results with
  titles, URLs and snippets; `fetch` returns the cleaned text of one page.
- **Both run on the server**, through the research service that already holds
  the provider credentials and records the run. No new server contract was
  needed — the endpoints existed and nothing called them.
- **Everything returned is marked untrusted.** It is content someone else
  wrote: evidence to weigh, never instructions to follow.
- **A URL is checked before it is sent.** Only http and https; no embedded
  credentials; no loopback, private or link-local addresses. The model's choice
  of URL is untrusted input, because a workspace file or a fetched page can put
  one in front of it.
- Research mode still exists and still works. It answers "should this message
  be grounded"; the tool answers "I need to check one thing", which is the
  question that comes up in the middle of a run.

## 1.1.0

Minor: a focus view for reading (F068).

- **ClawAI: Toggle Focus View**, or the target button in the composer, hides
  the activity timeline, the compare tray and the run deck.
- **The conversation and the composer stay.** A reading mode that hid the
  conversation would be a blank screen, and one that hid the composer would be
  a transcript you cannot answer.
- **The way out stays reachable.** A mode you cannot leave is not a mode, so
  the toggle lives in the composer rail rather than in the chrome it hides.
- The choice is a workspace setting (`clawAI.viewDensity`), so it survives a
  reload and applies to every panel rather than the one you toggled.

## 1.0.0

Minor: conversations you can name and put away (F061).

- **ClawAI: Rename Conversation** gives a thread a name you will still
  recognise a week later. The derived first-sentence title was a guess made
  before the conversation had happened.
- **ClawAI: Archive Conversation** takes a thread out of the history list, and
  **ClawAI: Restore Archived Conversation** brings it back. Without the second
  one, archiving is a trapdoor rather than a filing cabinet.
- **Pinned conversations sort first** in the history list.
- No new server contract was needed: `PATCH /chat-threads/:id` has accepted
  `title`, `isArchived` and `isPinned` since before this client existed. The
  extension simply never called it.

## 0.99.0

Minor: chat tabs that say what they are doing, and an undo for closing one
(F063, F064, F066).

- **A tab shows its session's state.** A marker for running, waiting on you, or
  failed, and a dot for a finished run nobody has looked at yet. An idle,
  read session is prefixed with nothing — the ordinary case has to stay quiet
  or the markers stop meaning anything.
- **Unread is cleared by looking,** not by the next event, and a session you
  are looking at is never marked.
- **ClawAI: Reopen Closed Chat** brings back the session you closed most
  recently, subject and thread intact, up to ten deep. An empty chat is not
  remembered: it holds nothing to come back to, and remembering it would push
  a real conversation off the end.
- Tab titles now have one owner, so the subject, the activity marker and the
  unread dot cannot disagree about the same string.

## 0.98.0

Minor: `@` mentions with fuzzy matching (F032).

- **Type `@` in the composer** and a ranked list of workspace files and folders
  appears. Arrows walk it, Enter or Tab chooses, Escape dismisses, and picking
  a folder keeps the mention open so the next keystroke narrows inside it.
- **Matching is a subsequence, not a substring:** `wcs` finds
  `workspace-context-service.ts`. Matches in the file name beat matches in a
  directory, and runs of consecutive characters beat scattered ones.
- **A mention is real context.** `@src/app.ts` pulls that file in;
  `@src/app.ts:10-20` pulls exactly those lines, the same syntax that already
  worked without the `@`.
- **Secrets are never offered,** and a mention of one is dropped with the
  reason recorded in the context receipt rather than silently.
- The extension owns the matching, so the composer and the collector cannot
  disagree about what a mention means.

## 0.97.0

Minor: Plan mode survives a resume, and so does the plan it approved (F048).

- **Runtime Protocol V2 now tells the model it is in Plan mode.** Policy
  already denied every non-read effect there, so the model learned the mode by
  having each edit refused in turn. The instruction is applied where the run
  starts, so the journal's goal stays the raw request.
- **A run records its mode and its plan revision** on the durable run journal,
  which is what survives a window reload.
- **Restoring the mode is tighten-only in both directions.** A parked planning
  run does not start writing because the setting moved, and a workspace since
  switched to Plan is not overridden by an older Auto run.
- **The plan revision is read off the call, not the result,** so a run
  interrupted mid-export still recorded which plan it was exporting.
- See [docs/PLAN_REVISIONS.md](docs/PLAN_REVISIONS.md).

## 0.96.0

Minor: plan documents you can edit, and revisions that bind what follows (F047).

- **An exported Markdown plan carries the plan itself** in a trailing
  `clawai-plan-revision` comment block, so the file can be read back. Prose
  alone is lossy: a plan re-derived from headings would drop every field the
  renderer never printed.
- **`workspace.planning adopt` reads a document back.** It parses either export
  format, validates it against the plan schema, and reports whether the plan
  moved (`revised`), stayed put (`unchanged`), or is the first one bound
  (`new`). Editing the prose around the block is not an edit to the plan.
- **A revision hash binds later work.** Any planning operation may name the
  revision it read; naming a superseded one is refused as stale rather than
  acted on. Naming none stays allowed, and adopting a plan still grants no
  execution permission.
- See [docs/PLAN_REVISIONS.md](docs/PLAN_REVISIONS.md).

## 0.95.0

Minor: nested `.clawai` memory files, with precedence (F076).

- **A subdirectory can carry its own `.clawai/rules.md`,**
  `architecture.md` and `memory.md`. Every directory from the workspace root
  down to the file you have open is searched.
- **Nearer guidance wins.** Files are read root-first and nearest-last, so a
  rule for one package speaks after the repository-wide rule it narrows.
- The walk is depth-bounded and never resolves outside the workspace.

## 0.94.0

Minor: a usage dialog (F107, client half).

- **ClawAI: Show Usage** lists the day, week and month windows and every
  feature that carries a limit. All of it already arrived with your account
  and was shown as one status-bar tooltip line.
- An unlimited window shows no percentage rather than 0% or 100%, and
  features that are unlimited and unused are left out so the ones running
  low are visible.
- Not included: per-skill, subagent, plugin and workflow breakdowns. Those
  dimensions do not exist in the backend ledger yet.

## 0.93.0

Minor: correct the proposal in the diff before applying it (F056).

- **The right-hand pane of a ClawAI preview is editable.** Fix the proposal
  where you noticed it was wrong, then approve; what you edited is what gets
  written.
- Only the content is taken from your edit. The file, the operation and the
  root stay what you approved, so an edit cannot turn an update into a
  delete.
- The left pane stays read-only, and unsaved edits still count — you do not
  have to save the preview before approving.

## 0.92.0

Minor: an autosave policy for edits (F058).

- **`clawAI.autosave`** adds `before-edit` beside the existing default.
  Set it and ClawAI saves the files an edit touches instead of refusing the
  edit because a buffer was dirty.
- Only the files the edit already names are saved, and only before the
  review snapshot is taken — saving later would change the file the review
  was about.
- The default is unchanged: `off`, and dirty-buffer drift still fails closed.

## 0.91.0

Minor: run history is searchable, by you, with facets (F060).

- **ClawAI: Search Run History** asks for a query and an outcome, then lists
  what matched. Searching journals existed before this, but only as a tool
  the model could call.
- **Facets narrow the search**: outcome, exact label, pinned, and an
  updated-since bound. Previously the goal text was the only thing a search
  could say.
- Results open the same redacted export the agent gets, so browsing history
  cannot see more than that export allows.

## 0.90.0

Minor: the agent can declare a run finished, and cannot do it behind your
back (F031).

- **`runtime.end`** writes a terminal lifecycle and the reason into the run
  journal, so a finished run leaves a record of how it ended.
- **Refused while you still owe an answer.** If an approval or a question is
  on screen, ending is refused and the refusal names which one. There is no
  override: a run that could end past a prompt would leave you answering for
  work that had already stopped.
- It records terminality rather than killing the loop, so the record it is
  writing cannot be the thing the cancellation destroys.

## 0.89.0

Minor: send feedback with a diagnostic report you read first (F027).

- **ClawAI: Send Feedback** builds a report describing the installation —
  versions, connection state, modes, recent run ids, and a redacted last
  error — opens it in an editor, and sends it only when you choose Send.
- **What you approve is what is sent**, edits included. Closing the editor
  sends nothing.
- The report has no field for a prompt, a transcript, a path or file
  content, and the backend URL is reduced to its origin.
- A submission that fails says so. It is never reported as sent.

## 0.88.0

Minor: the files the agent makes for you are now delivered, not just written (F024).

- **A Delivered Files view lists every artifact this session produced**,
  newest first, and every row opens the file. The artifact write already
  carried provenance, a hash and a size; none of it reached you.
- Re-delivering the same path replaces its row rather than adding a second
  one pointing at the same file, and a rolled-back or failed transaction
  delivers nothing.

## 0.87.0

Minor: notifications when a run needs you or finishes without you (F023).

- **The agent can reach you with `runtime.notify`.** One sentence, info or
  warning, for a result you are waiting on. It asks nothing and returns
  nothing to act on — `runtime.ask` is still the way to put a decision to
  you.
- **Approvals, questions, failures and completions notify on their own.** No
  more discovering an hour later that the run stopped on an approval nobody
  clicked.
- **Nothing fires while the window has focus.** A notification exists to say
  come back; if you are already looking at the panel you can see all four of
  those without being told.
- **VS Code owns the off switch.** Do Not Disturb and the per-source
  notification controls already decide this for every extension, so there is
  no second ClawAI setting to disagree with them.

## 0.86.0

Minor: the main session can create, address, and remove its own Git
worktree (F017).

- **`workspace.git create-worktree` now takes a `newRootKey`.** After the
  worktree is created, that key resolves on every later `workspace.files`
  and `workspace.git` call, the same way `workspace-1` already does for the
  primary folder. Previously the worktree existed on disk but nothing could
  ever address it again.
- **`workspace.git remove-worktree` cleans one up.** `git worktree remove
--force` plus releasing the key, only after the command actually
  succeeds — a failed removal leaves the worktree addressable rather than
  silently orphaning it.
- **A `newRootKey` cannot shadow an advertised `workspace-N` key.** A
  sub-agent worktree is allowed to register under the key its own task runs
  as — that is what keeps it from escaping into the parent checkout by
  accident — but the main session has no equivalent binding, so a
  `create-worktree` call from it is refused outright if it tries to reuse
  one of those keys instead of picking its own.
- Not a stateful "enter/exit": every call in this protocol already carries
  its own explicit root, so there is no implicit "current directory" to
  switch. The substance — create, address, clean up — is there.

## 0.85.0

Minor: line-range references and coordinate-preserving selection context
(F033).

- **Type `path:L-L` (or `path:L`) directly into a message to pull that exact
  range of a workspace file into context.** No autocomplete yet — that
  discovery layer is a separate, later feature — but the reference resolves
  today: `src/service.ts:40-58 what does this do?` sends exactly those
  lines. A reference outside the workspace, to a missing file, or past the
  end of a file is silently skipped rather than failing the send, since
  these tokens come from free-form prose, not a deliberate command. The
  existing sensitive-path and exclude-pattern checks still run
  unconditionally: an explicit `.env:1` reference is refused the same way
  every other path into context already is.
- **A selection's line range now survives into the request.** `Ask about a
selection` previously sent the selected text with no way to say which
  lines it came from. The range now travels through the context receipt and
  onto the `<workspace-file startLine="..." endLine="...">` tag the model
  actually reads.
- **Choosing "None" context still means none.** A reference found in the
  prompt text is not resolved when the selected context mode is `none` —
  the deliberate choice to send no context always wins over an incidental
  `path:L-L`-shaped token in the message.
- Not yet closed: stale-range UI. Nothing re-hashes a referenced file to
  flag that it changed since the range was collected; adding an unread hash
  field now would only have been unwired data.

## 0.84.0

Minor: adds JSON schema autocomplete for `.clawai` config files (F085).

- **`policy.json` and `agents.json` get editor validation.** Two new
  `contributes.jsonValidation` entries point at hand-authored schema files
  mirroring `projectPolicySchema`/`policyRuleSchema` and
  `subAgentDefinitionSchema`. Kept in sync by a test asserting the same
  property set both directions, rather than generated, since no `.ts`-import
  precedent exists in `scripts/` for a build step that small.

## 0.83.0

Minor: adds named, persisted sub-agent presets (F007).

- **`.clawai/agents/agents.json` defines reusable sub-agent identities.** A
  preset has a `name`, `description`, and `systemPrompt`; a sub-agent task can
  reference one by `definitionName` instead of restating instructions on
  every fork. The role enum (`explorer`, `implementer`, `tester`, `reviewer`,
  `security-reviewer`, `documenter`, `integrator`) is unchanged and still
  gates behavior directly, most visibly the integrator-only Git mutation
  exception — `definitionName` is additive, not a replacement.
- **A definition only ever adds instructions, never a runtime grant.** Tools,
  model policy, budget, and risk ceiling still come from the task itself on
  every fork; a preset's `systemPrompt` and `description` prepend to that
  fork's prompt and nothing else. The file is workspace content, trusted the
  same way `rules.md` already is, and safe for the same reason
  `policies/policy.json` is: it can only instruct, never widen.
- **Absent means no presets**, matching `policies/policy.json`: the file is
  opt-in and not created by **ClawAI: Initialize .clawai**.

## 0.82.1

Patch: fixes a `runtime.agents` fork schema-drift bug found while auditing
F028 (ToolSearch).

- **`mandatoryGateIds` no longer offered on a sub-agent task.** The JSON
  schema shown to the model for `runtime.agents run` advertised a
  `mandatoryGateIds` property on every task, copied from the unrelated
  `integrationRequest` shape. `subAgentTaskSchema` is `.strict()` and never
  accepted that key, so a model that took the offer had the whole fork
  rejected with an unrecognized-key error. The property is removed from the
  advertised schema; a regression test locks the advertised task properties
  to the set the validator actually accepts, so the two cannot drift apart
  silently again.

## 0.82.0

Minor: finishes F052 enforcement — an organization's model allowlist and
permission floor are now applied, not only carried.

- **Model allowlist reaches local models.** `applyOrganizationModelAccess`
  filters the whole catalog, including local Ollama and llama.cpp models. The
  existing entitlement filter deliberately exempts local models — a local model
  costs nothing, so a billing entitlement has no opinion on it — but an
  organization allowlist answers a different question, what a member is
  _permitted_ to use, and an unvetted local model is exactly what an
  organization would forbid. An empty allowlist still means every model,
  matching the backend intersection and the 0.81.0 tool allowlist.
- **`minimumPermissionMode` now clamps mode selection.** Requesting a mode more
  permissive than the organization's floor silently selects the floor instead;
  a mode at or under the floor, or outside the ranked scale
  (`ENTERPRISE_LOCKED`), passes through unchanged. The clamp runs before the
  Autonomous Scoped confirmation dialog, so a request the organization has
  already ruled out never reaches a dialog asking the user to confirm it.
- Both were the two fields 0.81.0 named as stored and served but not yet
  enforced, because an invocation carries neither a model nor a mode — the tool
  evaluator was the wrong place for either. They are enforced at the two points
  that do carry that information: the model picker and the mode selector.

## 0.81.0

Minor: an organization can constrain what this client may do.

- The extension fetches `GET agent/organizations/policy/effective` with the rest
  of the account data and enforces it in the same evaluator every tool call
  already passes through. `enterprise-policy.ts` has carried a complete policy
  implementation with zero importers since it was written, because nothing
  served it a policy; the endpoint added alongside this release does.
- The backend returns the intersection of every organization the user belongs
  to, so belonging to a permissive organization cannot loosen a stricter one,
  and it never names which organization imposed a constraint.
- An organization may tighten and may never loosen. It is consulted after the
  immutable rails, so it cannot reach past a workspace-trust denial or the
  elevation, production and destructive rails, and before the project policy, so
  a project cannot widen what an organization refuses. Both are proven by test.
- An empty tool allowlist means every tool is permitted, matching the backend
  intersection. Reading it as "nothing allowed" would deny every call for every
  organization that has not set the field.
- A backend with no such endpoint yields no policy rather than an error, so a
  client pointed at an older deployment keeps working. Failing open is correct
  here and only here: the endpoint exists to tighten, so its absence can only
  mean nothing extra is imposed.
- The policy is unsigned on purpose. Every field narrows, so a forged one could
  only refuse work, and entitlements — which gate money — already arrive over
  the same authenticated channel. `verifyEnterprisePolicy` is retained for a
  distribution that must also survive a compromised backend.
- Still enforced elsewhere, not here: `allowedModels` needs the model picker,
  and `minimumPermissionMode` needs the configuration clamp. An invocation
  carries neither, so enforcing them in the tool evaluator would be the wrong
  place. Both are named in `docs/parity/PROGRAM.md`.
- The four model-catalog endpoints move into `model-catalog-client.ts`;
  `backend-client.ts` was on its 500-line ceiling.

## 0.80.0

Minor: `vscode://` links can open the view or a conversation, and nothing else.

- Adds a URI handler for `vscode://clawai.clawai-coding-agent/open` and
  `/session?id=<uuid>`, so the ClawAI web app can link into an open
  conversation.
- The surface is deliberately narrow, and the reasoning is recorded in
  `docs/adr/0001-uri-handler-navigation-only.md`. A `vscode://` link is
  triggerable by any web page, so no credential passes through it, no prompt
  text comes from it, and no side effect follows from the link alone. It cannot
  express a command, an approval or a connection, which removes the injection
  vector rather than mitigating it.
- Authorization is untouched and still uses the state-validated one-shot
  loopback callback. The 2026 decision to remove the URI **authorization**
  callback stands permanently; this narrows a blanket absence that also
  forbade surfaces carrying none of that risk.
- No `onUri` activation event is added. Activation is already
  `onStartupFinished`, so the handler registers in every window regardless, and
  the extension-host assertion that guarded the authorization boundary is
  unchanged and still passes. A unit test now asserts the same property at the
  source level.
- An unrecognised link is ignored rather than raising an error, because a
  dialog from a link the user did not knowingly click is a nuisance a page
  could trigger repeatedly.

## 0.79.0

Minor: the agent keeps a task list, and the sidebar shows it.

- `workspace.planning` gains `set-tasks` and `list-tasks`. The tool was
  stateless — validate, render, export — so there was no record of what the
  agent was working through, and a user watching a long run could not tell
  which step it was on.
- Tasks are run state, deliberately separate from the implementation plan.
  `implementation-plan.ts` models epics, capabilities and stories where every
  task needs an acceptance criterion and a verification step. That is right for
  a plan someone reviews and wrong for "what am I doing right now", where the
  cost of writing it down has to be near zero or it does not get written.
- At most one task may be in progress. A list where three things are in
  progress is a list of intentions rather than a record of work, and holding
  the invariant means a reader can always answer "what is happening now" with
  one line.
- The list is replaced wholesale rather than patched. An agent restates what it
  is doing far more reliably than it emits a correct diff against a list it
  cannot see, and a replace cannot leave the store disagreeing with the model.
- Order is preserved rather than grouped by status: the order the agent wrote
  is the order it intends to work, and sorting by state would move a task the
  moment it started — which is when a reader is looking at it.
- Adds a **Tasks** view beside Findings. Tasks and findings are cleared
  together when the workspace folder changes, because both describe a tree that
  is no longer open.

## 0.78.0

Minor: a run can be recapped instead of re-read.

- Adds **ClawAI: Session Recap**, which summarises a recorded run: the goal,
  files changed, tool calls, failures, unfinished calls, outstanding findings,
  what is blocking a resume, and the one thing worth doing next. Returning to a
  session replayed the raw messages and nothing else, so learning that three
  files changed and the last tool call failed meant reading the whole transcript
  and inferring it. Every one of those facts was already in the run journal;
  none was ever summarised.
- A failed tool call is counted separately from one left mid-flight by a
  restart. They mean different things to a reader: a failure happened and is
  known, while an unfinished call may or may not have taken effect.
- The suggested next action is ordered by what ignoring it would waste. A
  drifted workspace has to be replanned before anything else is attempted; a
  stale approval has to be granted again before a resume proceeds; a failure is
  worth understanding before it is repeated; findings are worth reading before
  more code lands on top of them.
- A low-confidence finding does not become the next action, for the same reason
  it does not block a release: it is a question rather than a verdict.

Also records a blocked feature honestly. F059 conversation rewind cannot be
built on this client: the backend can delete a whole thread but has no
message-level delete and no fork, so there is no way to drop later turns and
continue. It is BLOCKED on a backend contract, like F052.

## 0.77.0

Minor: undo takes back more than the last change.

- **ClawAI: Undo Last Edit** can be run repeatedly, up to twenty applied
  transactions deep. It remembered exactly one, so a run that made three edits
  could take back the third and no more — and the third is rarely the one a
  reader objects to.
- The notice says how many earlier changes remain, because a user otherwise
  cannot tell a stack with history left from one that has reached the end.
- The stack is bounded, and the oldest entry is dropped rather than the newest.
  Each entry holds the before-state bytes it would restore, so an unbounded
  history is an unbounded amount of the workspace held for a session that may
  never undo anything.
- A failed rollback leaves its entry in place so the same undo can be retried.
  Popping it would discard the only record of how to restore the file.
- The history is cleared when the workspace folder changes, along with the
  reported findings: an entry restores bytes into the workspace it was captured
  from, and replaying one into a different tree would write a stale file.

## 0.76.0

Minor: search can return the lines either side of a match.

- `workspace.files search` takes `contextLines`. A match arrived as one line,
  so deciding whether a hit was the definition or a passing mention meant a
  separate read of the file — once per hit worth judging.
- Context is off by default and capped at ten lines either side. The result cap
  is shared across matches, so generous context spends the answer on fewer of
  them, and three lines is usually enough to judge one.
- Context clamps at the start and end of a file rather than padding, and each
  line is bounded to the same 500 characters as the preview.

Also records two audit corrections in `docs/parity`. F050 is closed without a
fourth deny mechanism: tools are extendable through the 0.75.0 policy rules,
context collection through `.clawai/ignore`, and attachments through the 0.65.0
name screen, with built-ins add-only at all three.

## 0.75.0

Minor: a project can write permission rules, not just effect classes.

- `.clawai/policies/policy.json` gains `rules`. Scoping was by effect kind and
  risk class only, so a project could say "deny every network write" but never
  "deny pushing to this remote" or "always ask before touching `infra/`".
- A rule matches on any of `tool`, `operation`, `pathGlob` and `commandGlob`,
  and must name at least one: a rule that matches nothing in particular matches
  everything, which is never what the author meant. `pathGlob` is tested against
  the paths a call actually names, collected from the argument shapes the tools
  use rather than by walking the whole object, so a rule matches what the call
  will touch.
- **A rule may tighten and may never loosen: `outcome` is `ask` or `deny`, and
  there is no `allow`.** The policy file lives inside the workspace, and
  workspace content is untrusted — a repository that could write `allow` would
  grant itself permissions by being cloned. Rules are evaluated after the
  immutable rails, so none can reach past a workspace-trust denial or the
  elevation, production and destructive rails. Both are proven by test.
- Order does not matter: when rules disagree, `deny` wins over `ask`, so a
  hand-written file can be read without simulating the list.
- Patterns are `*` globs compiled from escaped literals, not regular
  expressions. An expression from an untrusted file is a denial-of-service
  waiting for the right input; a glob with no nested quantifier has nothing to
  exploit.
- `docs/CLAWAI_FOLDER_SPEC.md` documents `policies/policy.json`, which it had
  never mentioned despite the file being read since the policy service was
  added.

## 0.74.0

Minor: reviewer sub-agents report findings instead of prose.

- `SubAgentOutcome` carries a `findings` array. The reviewer and
  security-reviewer roles were enum labels with nothing behind them: a reviewer
  wrote its conclusions into its response, so the parent could not count them,
  merge them with a second reviewer's, or decide whether they blocked.
- Findings are captured from the reviewer's own `workspace.quality report`
  call, the same way writes are already captured from a transaction, so a
  reviewer reports through the tool a person can also read rather than through
  a channel of its own.
- Each finished task files what it found, so several reviewers over one diff
  merge into a single triage-ordered list in the Findings view. A cancelled or
  blocked reviewer keeps the findings it reported before it stopped: what it
  found is not conditional on how its task ended.
- A malformed report is dropped rather than failing the task. A reviewer that
  found something real and described one finding badly should still deliver the
  rest, and the tool call itself reports the validation error.

## 0.73.0

Minor: a review can report structured findings, and a person can read them.

- `workspace.quality` gains `report` and `list-findings`. Review output was
  free text: `SubAgentOutcome` had no findings field and the reviewer roles were
  inert enum labels, so nothing could be counted, deduplicated, ordered or
  compared between runs.
- A finding requires a remediation and a confidence. A finding without a fix is
  an observation, and a review that produces observations makes the reader
  decide what to do with each one. A reviewer that cannot be wrong reports
  everything at the same weight, and a list where nothing is uncertain is a list
  nobody triages.
- Findings from different reviewers merge on location and title rather than on
  the whole record, so the same claim collapses even when two reviewers phrased
  their detail differently — which is the normal case, because independent
  reviewers converge on the obvious bug. When duplicates disagree on severity
  the highest wins: over-reporting costs a minute of reading, under-reporting
  costs the bug shipping.
- Order is severity, then confidence, then location, and is stable across runs,
  so two reviews of the same code can be compared.
- `blocksRelease` is true only for a critical or high finding that is not
  low-confidence. A low-confidence critical is a question, not a verdict, and
  blocking on one trains the reader to override the gate.
- A finding must name a workspace-relative, non-credential-shaped path, through
  the same rule every tool schema applies.
- Adds a **Findings** view to the ClawAI sidebar showing what has been reported,
  ordered for triage, with the detail and the remediation on the hover. Findings
  clear on an account or workspace boundary, because a finding names a path in a
  workspace that is no longer open. Reporting into a store nobody reads would
  have been the sixth dead subsystem this parity audit has found.

## 0.72.0

Minor: truncated command output keeps the end, where the error is.

- Both command runners kept the first bytes up to the output limit and dropped
  everything after. Compilers, test runners and package managers all put the
  answer last — the failing assertion, the type error, the exit summary — while
  the start is banners and dependency resolution. A build that overran its
  budget therefore returned the banner and dropped the reason it failed, which
  reads as though the command produced nothing useful.
- Output now keeps the first quarter of the budget and the last three quarters,
  with an explicit `… N bytes omitted …` marker between them. The marker states
  the byte count, so an elided log is distinguishable from a complete one rather
  than inferred from a suspiciously abrupt line.
- The budget is split between the streams, so a chatty stdout can no longer
  consume all of it and leave nothing for the stderr that usually carries the
  reason. Proven by spawning a real process that writes 200 kB to stdout and one
  line to stderr.
- Memory stays bounded however much a command writes: the head stops growing
  once its share is full and the tail is trimmed on every chunk.
- The development-command runner also decoded each chunk separately, which split
  any multi-byte character that straddled a chunk boundary. Decoding happens
  once, at the end, and a sequence cut by the byte budget itself yields a
  replacement character rather than throwing.

## 0.71.0

Minor: a conversation can be exported to a file.

- Adds **ClawAI: Export Transcript**, which writes one conversation as Markdown
  or JSON. The run journal and the evidence bundle already exported, but both
  describe a run rather than a conversation and both were reachable only as
  agent tools, so there was no way for a person to keep what was said — which
  is what a support request or a review actually wants.
- Every exported string passes through `redactText`, including the title. An
  export leaves the extension the moment it is written, and a transcript is the
  likeliest place for a token to be sitting because a user pastes one in to ask
  why a request failed. Redacting at the boundary means a future field cannot
  leak by omission.
- The suggested filename is derived from the conversation title reduced to word
  characters, so a title cannot carry a separator, a traversal or a Windows
  reserved character into a path. The save dialog is the whole permission
  model: nothing is written until the user names the destination.
- The conversation is picked rather than inferred from focus. There is no
  active-session concept to infer from, and the transcript worth exporting is
  often an earlier one.
- The transcript is read from the backend thread, not from the webview or from
  `TranscriptEntry` in `chat-session.ts`. That type is declared with no
  producers and no consumers — the fifth instance of the pattern the parity
  audit keeps finding — so exporting from it would have meant inventing the
  data it describes.
- The palette delegates on `AgentCoordinator` move into
  `agent-coordinator-commands.ts`. Two consecutive batches pushed that file two
  or three lines past its 500-line ceiling, which is the ceiling working: the
  fix is to move a group out, not to shorten a line.

## 0.70.0

Minor: the agent can ask the language servers, instead of searching for a name.

- `workspace.intelligence` gains `definition`, `references`, `implementations`
  and `hover`, each taking a one-based position. Until now the only way to find
  where something was defined was to search for its name and read the hits,
  which finds every mention of the word and cannot distinguish a definition
  from a comment about one.
- Results are deduplicated. Providers answer once per overload and once per
  re-export, so the same position arrived repeatedly and spent the result cap on
  duplicates. They are ordered by path and position rather than by whichever
  provider answered first.
- `LocationLink` is read as well as `Location`. TypeScript returns the former,
  so reading only `uri` and `range` would have returned nothing for the language
  this extension is mostly used on — which looks exactly like "no definition
  found".
- Locations outside the workspace and on credential-shaped files are dropped,
  through the same path rule every tool schema applies. `preview` quotes a line
  of source, so emitting one is a read in every sense that matters. A definition
  inside `node_modules` is still a legitimate answer and is kept.
- A preview is only taken from the document already open for the query.
  Opening every target to quote a line would turn one navigation into an
  unbounded read of files the caller never named.
- A host with no language servers returns an error rather than an empty list,
  for the same reason 0.67.0 does with diagnostics: "no definition here" and
  "cannot tell" are different answers.
- The diagnostics filter added in 0.67.0 now uses `isSafeRelativeWorkspacePath`
  rather than its own near-copy of the rule, so there is one path rule and not
  two that can drift.

## 0.69.0

Minor: the agent can ask the user a structured question instead of guessing.

- Adds `runtime.ask`, a tool that puts one multiple-choice question to the user
  and waits for the answer. Until now the only interruption available was a
  yes/no approval attached to a side effect, so a model facing a genuine fork
  either guessed or wrote the question into its prose and carried on without an
  answer.
- A question takes two to four options, each with an optional description, and
  by default allows free text so the user can give an answer the options miss.
  One option is a statement rather than a question, and more than four stops
  being readable in a 320px sidebar or navigable from the keyboard.
- It rides the approval broker rather than a channel of its own. One queue, one
  modal slot, one cancellation: a run that ends withdraws its question through
  the same `cancelKind` it already uses for approvals, and the same account and
  workspace epochs invalidate both.
- A dismissed question is reported to the model as dismissed and never as a
  choice. The agent asked because it could not decide; answering on the user's
  behalf would put words in their mouth and hide that the question went
  unanswered.
- The selection is validated against the question that was actually asked, not
  merely shape-checked, so a stale or forged selection — one naming an option
  from an earlier question — resolves nothing and leaves the question standing.
- Options are buttons with a pressed state rather than a listbox: one tab stop
  each, legible at 200% zoom, correct under RTL through logical properties, and
  given a Highlight border under forced colours where the selection background
  is flattened.

## 0.68.0

Minor: the conversation token meter has a denominator, and the run budget meter
stops calling itself something it is not.

- The meter now reads `used / capacity` against the selected model context
  window. `contextTokens` has been in the model catalog all along, populated
  from four different backend shapes, and nothing read it — so the meter showed
  a running total against nothing, a number that cannot say whether the window
  is comfortable or nearly spent. It also sets a percentage the stylesheet can
  fill.
- AUTO routing and a model that reports no window both keep the old
  denominator-free form. There is no single capacity to measure against, and
  inventing one would be worse than omitting it.
- The run budget meter counted tool calls while announcing itself to screen
  readers as "tokens" — the one thing on screen it does not measure. It is now
  labelled "Tool calls used".
- Adds the webview proof that 0.65.0 shipped without: `.env` is refused in the
  composer with the message that names the reason, and
  `password-reset.controller.ts` still attaches.

## 0.67.0

Minor: the agent can read the editor's Problems collection.

- `workspace.intelligence diagnostics` returns what the language servers have
  already computed. Until now the only way to learn that a file had a type error
  was to run a full `workspace.quality` gate and parse its stdout, which costs a
  build and only covers the gates a project happens to define. The editor has
  the answer per keystroke, for every installed analyzer.
- Errors sort first, then path, line and column. A truncated list that opened
  with formatter hints and never reached the errors would read as if the errors
  were not there. `total` and `counts` describe every match even when the shown
  list is capped, and `minimumSeverity` defaults to `warning`.
- Two filters are boundaries rather than conveniences. The editor reports
  problems for every open document, including files opened from outside the
  workspace, so anything that does not resolve to a workspace-relative path is
  dropped — a diagnostic message quotes the source line, and an absolute path
  from elsewhere is content this tool was never granted. Credential-shaped
  paths are dropped for the same reason: a parse error in `.env` would put a
  line of it in the message.
- A host that exposes no diagnostics returns an error, not an empty list. "No
  problems" and "cannot tell" are different answers, and a model that cannot
  distinguish them reports a clean workspace.
- The operation classifies as an unprompted read, proven by test, so the
  cheapest read in the runtime never reaches the approval broker.

## 0.66.0

Minor: workspace search now searches the workspace.

- `workspace.files search` opened at most 100 files. One `maxResults` argument
  was passed to `findFiles` and then reused to slice the matches, so the result
  cap was also the candidate cap: a search of an 8,059-file repository read
  about one percent of it and reported nothing found. To a model that is
  indistinguishable from proof of absence, and nothing in the output said only a
  hundred files had been opened. The two limits are now two numbers — up to
  5,000 candidate files or 32 MiB, whichever comes first — and the result
  carries `scannedFiles`.
- `truncated` now means what it says. It is set when the candidate set
  saturated, when the byte budget ran out, or when results hit the cap, so an
  empty result is only evidence of absence while it is false. The tool
  description says so.
- `glob` and `search` skip dependency and build output. `findFiles` does not
  read `.gitignore`, and both operations passed no exclude at all, so a bare
  `**/*.ts` returned whatever the walker reached first — on this repository,
  files under `.worktrees/`, which holds a full checkout per in-flight branch.
  The exclusion that fixed the intelligence index in an earlier release had
  never reached the tool the model actually calls.
- `search` takes `regex: true` for a JavaScript pattern and `ignoreCase: true`
  to fold case. The default stays literal, and a literal query is escaped, so
  searching for `config.get(` still means those characters. An unusable pattern
  is reported as a tool error instead of quietly matching nothing, and a
  caller-supplied regex runs against a bounded line prefix so a nested
  quantifier cannot hang the run.

## 0.65.0

Minor: composer attachments are screened against the credential-name policy that
already guards every other path into the product, and the Claude-parity program
is audited and registered.

- A file whose name looks like it stores credentials can no longer be attached.
  `src/core/chat-attachment.ts` previously imported `node:buffer` and `zod` and
  nothing else, so a multi-select or a folder drop that swept in `.env`,
  `id_rsa` or `service-account-credentials.json` uploaded it silently, while
  context collection and every tool refused the same file. Attachments now use
  the same `isSensitiveWorkspacePath` predicate, so the boundary is one rule
  rather than two. Code that merely implements a secret, such as
  `password-reset.controller.ts`, still attaches.
- The refusal is enforced in the extension host and repeated in the webview.
  The host decides; the webview repeats the check only so the user sees which
  file was refused and why, instead of the generic invalid-request error. A
  package audit assertion keeps the webview copy from being deleted as
  duplication.
- The screen is on the filename, not the bytes. It stops an accidental sweep and
  is not a defence against a user determined to paste a secret.
- Adds `docs/parity/`: a classification of all 108 requested parity features
  against the code with file-and-line evidence, a recorded green baseline, and
  the batch order the audit implies. Six features are shipped, 50 partial, 50
  missing and 2 in conflict.
- Adds `skills/setup-a-fresh-worktree`: `npm ci` fails on Windows in a fresh
  worktree, and the obvious repair makes `npm run build` fail instead.
- Adds a blocker to `AGENTS.md`: no capability may be described in the changelog
  or docs before a call site reaches it. Four subsystems were found claimed and
  uncalled at 0.64.4 and are named in `docs/parity/PROGRAM.md`.

## 0.64.4

Patch: active Runtime V2 runs can recover safely after an extension-host restart.

- New runs persist an encrypted, versioned recovery capsule containing the exact
  backend binding contract, bounded tool catalog, cursor, and consumed budget.
- Startup recovery runs only after authentication, validates account/workspace/
  target/policy/files/Git fingerprints and live handles, and fails closed on
  legacy journals, drift, uncertain non-repeatable effects, or missing bindings.
- Eligible runs are adopted without a duplicate start request, reopen SSE after
  the last accepted sequence, preserve consumed allowances, and keep checkpointing
  authoritative budget and terminal events.
- The real VS Code host test now opens the ClawAI workbench command, allowing the
  exact installed VSIX path to prove activation, command registration, and UI
  resolution together with the unchanged Playwright visual suite.

## 0.64.3

Laboratory release: makes readiness claims evidence-bound and release identity
verifiable.

- Adds typed experiment records, a weighted readiness scorer with hard caps, a
  sanitized baseline bootstrap, and local/installed/artifact parity probes.
- Binds SLSA provenance to the clean source commit and verifies that binding in
  release CI and package audits.
- Enforces coverage for 39 critical runtime/security files and keeps the source,
  extension-host, Playwright, localization, packaging, and dependency gates in
  the CI path.
- Corrects README and Runtime V2 API truth, including authenticated run, result,
  steering, cancel, and resumable SSE routes.
- Refreshes and visually verifies the six intentionally changed Windows UI
  baselines without weakening screenshot assertions.

## 0.64.2

Patch: two runtime fixes rebased onto the 0.64 line. Both were first cut as 0.63.3 and 0.63.4, before main moved to 0.64; they are re-released here unchanged in behaviour.

### From 0.63.4

Patch: a second VS Code window no longer signs the first one out.

- One ClawAI session is shared per backend origin across every window, but binding refused any session id it had not seen before. Signing in from a second window rotated the shared record, and the first window's next bind threw and dropped it to the Connect gate with its queued message lost — so two windows could never both work, and reconnecting one evicted the other. The account, not the session id, is now what may not change underneath a client: a rotation owned by the same account is adopted, a takeover by a different account still fails closed, and a record written before accounts were stored keeps the old strict behaviour rather than being adopted on faith.
- The account id is recorded on the shared session record at sign-in. It comes from the profile the extension already fetches, and `POST /auth/vscode/authorize/exchange` now returns it alongside the tokens so the binding decision does not depend on a second round trip.

### From 0.63.3

Patch: a run that exhausts its budget now ends visibly instead of stalling.

- Budget exhaustion threw a bare `Error`, so nothing upstream recognised it as a terminal condition. No terminal event was published, the caller's compensation path saw an unfinished run and cancelled it, and the backend recorded `lifecycle: cancelled` with no reason. The activity panel kept a live spinner over a run that had stopped minutes earlier, which is indistinguishable from a slow run. Exhaustion is now a typed `RuntimeBudgetExhaustedError` and the run ends as `run.failed` carrying `RUNTIME_BUDGET_EXHAUSTED` and the limit that was reached, so the reason reaches the reader and no cancel compensation is needed.

## 0.64.1

Patch: a file too large to read can now be read — and therefore edited — instead of failing every attempt.

- A read defaulted to 262,144 bytes while the Runtime V2 contract caps any single string at 65,536, so reading a large file produced a structurally invalid result and came back as `TOOL_OUTPUT_INVALID`. Because `patch` needs the sha256 from a successful read, any file over the cap could never be modified at all. Every locale file in a large monorepo is well past that ceiling, which put translation work permanently out of reach. Reads are now bounded by what the contract can actually carry, and page instead of failing.
- A partial read still reports the whole-file hash, so a ranged read is a valid anchor for a patch. The result also carries `totalLines` and a `nextStartLine` cursor so the model can walk a large file to the end.
- Truncation lands on a line boundary. A mid-line cut handed the model a partial line it would then use as a patch anchor, which could never match.
- A missing file now says `No such file: <path>`, a directory says to use the list operation, and genuinely binary content says so. All three used to share "Requested file is not readable text", and a model told a file it had just created was unreadable kept probing it instead of moving on.
- A transaction carrying several operations now reports the actual rule — exactly one operation per call — instead of a per-operation schema failure about a missing `beforeHash`, which sent models off inventing hashes for files that did not exist yet.

## 0.64.0

Minor: the host now decides when a request warrants the flagship pipeline, instead of leaving it to the model to opt in.

- A brief that enumerates three or more deliverables is admitted automatically, and the flagship tool tells the model it is required for this request and why. Below that the pipeline stays out of the way: a single change is cheaper done directly than planned as a graph, and a planning round for two items costs more than it saves.
- Admission keys on enumerated deliverables rather than length, so a long bug report is still one bug. Sub-bullets under a single change do not count, and an enumerator inside a sentence does not either.
- The decision is applied before the tool catalog is hashed, so the description the model reads is the one the run committed to.

## 0.63.3

Patch: a flagship delivery now records which quality gates ran, and cannot mistake silence for a pass.

- Every gate the trusted host runs during integration is written to the delivery snapshot as an acceptance receipt, pass or fail. The results used to be discarded, so "the gates passed" survived only as wording in a summary; a failed gate now stays in the record with the integration it came from.
- An integration is no longer reported clean when a mandatory gate returned no result at all. An empty result set satisfied the every-gate-passed check, so a quality runner that silently produced nothing looked identical to one that passed everything. A mandatory gate with no result is now treated as failed.

## 0.63.2

Patch: two correctness fixes in flagship recovery.

- A task's runtime ceiling is now spent once across every attempt instead of being re-armed on each retry, which had made the real wall-clock bound (maxRetries + 1) times maxRuntimeMs. A retry inherits whatever remains of the original allowance.
- A cancelled implementation task now reaches the planner. Only failures counted toward the replan scope, so a cancelled task reported nothing to replan and the delivery re-ran the identical graph, cancelling the same task again.

## 0.63.1

Patch: the agent can once again write a source file longer than 100 lines. Runtime Protocol 2.0 sends a file body as one array entry per line, but arrays shared the 100-item object-entry ceiling, so any file over 100 lines was rejected — and the resulting validation error surfaced as an opaque internal error that ended the whole run instead of a correctable tool failure. Arrays now carry their own, much larger ceiling; the per-argument byte budget continues to do the real bounding, and the tighter object-entry ceiling is unchanged.

## 0.63.0

Minor: large flagship deliveries now survive interruption, run independent work in parallel, and recover from a failure instead of stopping at it.

- **Durable resume.** A flagship delivery checkpoints its validated progress and resumes at the next unfinished stage after an extension-host restart, instead of replaying work it already completed. A resumed checkpoint is accepted only when the account, workspace, target, and policy identity all still match; a changed request or a live identity change starts fresh rather than reusing stale mutations. Completed and unresumable checkpoints are cleaned up instead of accumulating.
- **Parallel implementation.** The planning stage now produces a host-validated task graph, and implementation dispatches that whole graph. Independent tasks run concurrently up to the admitted concurrency cap, dependent tasks wait for every declared dependency, and colliding write sets are refused before anything executes. Each task's share of the remaining turn and tool budget is reserved before dispatch, and a graph claiming writes outside the request's authorized write set is refused.
- **Classified recovery.** A failed sub-agent task is now classified — malformed tool output, empty provider response, discovery loop, timeout, or gate failure — and each class follows its own bounded strategy ladder, escalating from a constrained retry to a fallback model to a replan. One hypothesis can never be tried more than three times. A failure that leaves a mutating task's effects unknown is never replayed. A replan identifies the failed task and everything downstream of it, so independent successes are kept.
- Retried attempts now report the budget every attempt consumed and how many attempts were made, so aggregate ceilings stay enforceable and reported evidence matches reality.

## 0.62.2

Patch: explicit one-file small-patch requests can no longer silently replace a large existing file with a tiny model response. Legacy edit plans are checked against their before/after preview, while Runtime Protocol 2.0 rejects full updates, deletes, and oversized destructive hunks unless the prompt explicitly authorizes replacing the entire file. New-file creation and ordinary targeted edits are unchanged.

## 0.62.1

Patch: explicit Runtime V2 discovery limits now count only successful, contract-valid discovery results. A malformed or failed read releases its reserved allowance so the model can correct the request once, while successful reads and concurrent attempts remain bounded by the user's stated limit. Exact named-file scope checks are unchanged.

## 0.62.0

Minor: Runtime Protocol 2.0 now enforces explicit, unambiguous one-file discovery constraints from the user's prompt. When a prompt names `ONE FILE ONLY` and an `at most N read/discovery` limit, workspace reads are restricted to named files, repeated discovery stops at the stated limit with a concise correction, and writes remain available only for the named target. Ordinary prompts keep the existing unrestricted, budget-bounded behavior.

## 0.61.14

Patch: recover automatically from one explicit `CLOUD_PROVIDER_EMPTY_RESPONSE` without asking the user to restart the edit workflow. The retry resends the identical generation request once, remains abort-aware, and still requires the resulting strict edit plan to pass the existing trust, preview, and approval gates. The Runtime Protocol filesystem guidance is also compressed below the production 1,600-character catalog limit while retaining the targeted-discovery, small-mutation, and parser-safe Base64 instructions introduced in 0.61.13.

## 0.61.13

Patch: make Runtime Protocol 2.0 file work faster and more reliable. The model-visible filesystem contract now tells coding agents to act after a targeted search and read instead of repeatedly rediscovering unchanged files, to send one small mutation per call, and to use the existing Base64 fields for source containing braces, quotes, or backslashes so backend stream heuristics do not mistake complete source payloads for unfinished tool objects.

## 0.61.12

Patch: restore green release automation by formatting the diagnostics sink and its unit test, and by committing the complete versioned VSIX release assets required by the release gate.

## 0.61.11

Patch: focusing the prompt still activated the global textarea focus outline, which was clipped by the composer card and appeared as a bright border around the prompt and composer. The prompt now suppresses that redundant outline while retaining its caret and leaving keyboard focus indicators on every other control unchanged.

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
