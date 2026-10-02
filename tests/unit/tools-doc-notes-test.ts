import type { ToolNote } from './tools-doc.types';

/** The tools that let the agent test and ship its own work. */
export const TEST_TOOL_NOTES: readonly ToolNote[] = [
  {
    tool: 'process.watch',
    purpose:
      'Start something that outlives one call (a dev server, a slow push hook, watch-mode tests), wait for a line, read only what is new, stop it.',
    enable: '`--allow-tools command` (same allowlist as `workspace.command`).',
    operations: {
      start:
        '{name, executable, arguments[], cwd?}: start at once; returns `{name, pid, nextCursor: 0}`.',
      status: '{name?}: running, exit code, line count, output size.',
      output:
        '{name, sinceCursor?, maxChars?}: output since the cursor, plus `nextCursor`; no cursor = the latest lines.',
      wait: '{name, untilExit? | untilMatch?, timeoutMs?, sinceCursor?}: return on exit, on a matching line, or at the timeout.',
      stop: '{name}: kill the process and its children.',
      list: '{}: every process of this run.',
    },
    limits: [
      'At most 4 processes alive; names are 1 to 40 letters, digits, dots, dashes or underscores.',
      '`wait` defaults to 30 s and takes at most 10 minutes; `untilMatch` is a case-insensitive regex and also finds lines printed earlier.',
      '`output` returns 8,000 characters by default (32,000 at most); with no cursor it returns the LATEST lines, `sinceCursor: 0` the start.',
      'Output is redacted; everything is killed when the run ends, is cancelled or the host exits.',
    ],
    failures: [
      {
        message: 'processes may run at once',
        meaning: 'A fifth `start`. The message names the four that are running.',
      },
      {
        message: 'is already running; stop it or pick another name',
        meaning: 'A second `start` with a name already in use.',
      },
    ],
    cli: 'clawai -p "Start node server.js as web, wait until it prints listening, request it, then stop it" --allow-tools read,command',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'command'] } })",
  },
  {
    tool: 'code.gates',
    purpose:
      'Run the project’s own lint, typecheck, test, build and format checks and get a short, structured answer instead of a log.',
    enable:
      '`--allow-tools command`; `--done-check-gates lint,typecheck,test` makes the same gates a completion check.',
    operations: {
      detect: '{scope?}: the project’s gate commands and which folders the changed files are in.',
      run: '{gate: lint|typecheck|test|build|format, scope?: folder|"changed", files?, timeoutMs?}: run one gate.',
      report: '{}: the latest result of every gate, plus the gates nothing has run yet.',
    },
    limits: [
      'A result is about 250 to 600 characters: `status` (pass, fail, unavailable, timeout), error and warning counts, failing tests, `file:line:col` issues.',
      'A failing `test` gate re-runs its failing files once; a pass after a failure is `ok: true, flaky: true`.',
      'A gate that cannot run (no script, tool missing, program not allowed) is `unavailable`, never a pass.',
      'A passing run lists `notRun`: the other gates nothing has run yet.',
      'At a monorepo root a run needs a `scope`; it never runs over every workspace.',
    ],
    failures: [
      {
        message: 'The workspace root is a monorepo',
        meaning: 'Pass `scope: "changed"` or a folder.',
      },
    ],
    cli: 'clawai -p "Fix the failing tests" --allow-tools read,write,command --done-check-gates typecheck,test --auto-continue 3',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'write', 'command'] }, doneChecks })",
  },
  {
    tool: 'task.plan',
    purpose:
      'Keep a step plan for a big job; a step with a check cannot be marked done until the check passes.',
    enable:
      '`--task-plan`, `--plan-file <json>` or `--require-plan` (SDK `taskPlan`, `planSteps`, `requirePlan`). Never offered otherwise.',
    operations: {
      set: '{steps:[{id?, title, check?:{executable, args[], timeoutMs?}}]}: make the plan (30 steps at most; done steps are kept).',
      update:
        '{id, status: todo|doing|done|blocked, note?}: move a step; `done` runs the step’s check.',
      list: '{}: every step with its status.',
      next: '{}: the step in progress, else the first todo.',
    },
    limits: [
      'A run that ends `completed` with a step not done is continued (`reason: "plan-incomplete"`), then fails with `PLAN_INCOMPLETE` (exit 1).',
      'A check the MODEL writes needs the `command` grant and an allowed program; a `--plan-file` check is trusted and locked.',
      'The plan is saved outside the workspace (`<state-dir>/plan`, 64 KB at most) and survives `--resume`.',
    ],
    failures: [
      {
        message: 'checks run commands, and this run has no command grant',
        meaning: 'The model attached a check without the `command` grant.',
      },
      {
        message: 'This run requires a plan, and you made none',
        meaning: 'The run tried to finish under `--require-plan` with no plan.',
      },
    ],
    cli: 'clawai -p "Build the library step by step" --allow-tools read,write,command --require-plan --auto-continue 6',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'write', 'command'] }, requirePlan: true, autoContinue: 6 })",
  },
  {
    tool: 'knowledge.context',
    purpose:
      'Read the repository’s own rules, skills and docs the way an engineer would, before coding.',
    enable: '`--load-knowledge` (SDK `loadKnowledge: true`) with the `read` grant.',
    operations: {
      index: '{prefix?}: the knowledge files that exist.',
      read: '{path, startLine?, endLine?}: a file (8,000 characters; a large file returns its outline with line ranges).',
      search: '{query, limit?}: ranked sections with short snippets.',
      task: '{description}: the governing rule, skill and instruction files for this task, with line ranges (6 KB at most).',
    },
    limits: [
      'Only markdown and knowledge folders inside the workspace; it honours `.gitignore` and never enters `node_modules`, `dist` or `.git`.',
      'The files are advice: they cannot add a tool, an approval or write access. Results are marked untrusted and redacted.',
      'A new thread also gets a summary of at most 3 KB in front of its task.',
    ],
    failures: [],
    cli: 'clawai -p "Which rules govern adding a migration here?" --allow-tools read --load-knowledge',
    sdk: 'createAgent({ auth: { token }, workspaceRoot: dir, loadKnowledge: true })',
  },
  {
    tool: 'http.request',
    purpose: 'Send one HTTP request to test an API: status, headers and body, with secrets hidden.',
    enable:
      '`--http-allow-host <host>` (repeatable). GET and HEAD are `http`, POST, PUT, PATCH and DELETE are `http-write`. With no host the tool does not exist.',
    operations: {
      request:
        '{method, url, headers?, json? | body?, timeoutMs?, followRedirects?, expectStatus?, save?, maxBodyChars?}: send it.',
    },
    limits: [
      'Hosts: nothing is reachable by default. No port means 80 and 443. `*.example.com` matches subdomains only; a bare `*` is refused. Private addresses only when named.',
      'Link-local and cloud-metadata addresses are never reachable. Every redirect hop is re-checked (5 at most).',
      'Request body 256 KB; response read up to 256 KB; `bodyText` cut at 8,000 characters (HTML 1,500; `maxBodyChars` up to 24,000). Default timeout 15 s, maximum 60 s.',
      '`Authorization`, `Cookie` and token-shaped values show as `[REDACTED]`. `save {"tok": "accessToken"}` keeps a token the model can spend as `{{tok}}` but never read.',
      'No cookies are kept. TLS verification is always on (`NODE_EXTRA_CA_CERTS` or `node --use-system-ca` for a local CA).',
    ],
    failures: [
      {
        message: 'is not an allowed host',
        meaning: 'The URL’s host is not in `--http-allow-host`. The message lists what is allowed.',
      },
      {
        message: 'A URL with credentials is refused',
        meaning: 'The URL has a user name or password; send an `Authorization` header instead.',
      },
      {
        message: 'The certificate could not be verified',
        meaning:
          'Trust the CA with `NODE_EXTRA_CA_CERTS=<ca.pem>` or run node with `--use-system-ca`.',
      },
    ],
    cli: 'clawai -p "Check that the login API gives 401 for a wrong password" --allow-tools read,http,http-write --http-allow-host claw.local',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'http'], httpAllowHosts: ['localhost:3000'] } })",
  },
  {
    tool: 'browser.page',
    purpose:
      'Drive one real headless Chromium page to test a web UI: open, read, click, type, resize, screenshot, read errors.',
    enable:
      '`--allow-tools browser`, or `--browser-allow-host <host>` (which grants `browser` too). Needs `playwright-core` and a Chromium.',
    operations: {
      open: '{url}: go to a page; returns the final url, title and HTTP status.',
      snapshot:
        '{selector?, maxChars?}: visible text and an accessibility tree with `[ref=eN]`, focus, viewport and sideways overflow.',
      click: '{ref | selector | text}: click.',
      type: '{ref | selector, text, submit?}: type into a field, or pick a drop-down option by label.',
      press: '{key}: press a key (`Enter`, `Tab`, `ArrowDown`).',
      wait: '{selector | text | ms}: wait (30 s at most).',
      screenshot: '{fullPage?}: save a PNG under the OS temp folder and return its path.',
      resize: '{width, height}: set the window size (390 = phone); reports sideways scroll.',
      console: '{clear?}: recent console errors, warnings and uncaught page errors.',
      network: '{clear?}: failed requests and responses with status 400 or more.',
      close: '{}: close the browser; a later `open` starts a fresh one.',
    },
    limits: [
      'One page; 30 s to navigate, 10 s to find an element; 10 minutes of browser use per run; 30 screenshots.',
      'Only http and https. Private, loopback and local hosts are refused unless listed with `--browser-allow-host`; every request and redirect hop is checked.',
      'Downloads are refused. Page text, console and network entries are redacted and marked untrusted. `snapshot` takes a `selector` to look at one part of a big page.',
      'The typed `text` appears in the event stream: never let the model type real credentials.',
    ],
    failures: [
      {
        message: 'is a private or local host. The operator must allow it with',
        meaning: 'Add the host with `--browser-allow-host`.',
      },
      {
        message: 'which is not installed here',
        meaning:
          'Run `npm install playwright-core` and `npx playwright-core install chromium`, or set `CLAW_BROWSER_PATH`.',
      },
    ],
    cli: 'clawai -p "Open https://claw.local/login at 390 px wide, report overflow and console errors" --allow-tools read,browser --browser-allow-host claw.local',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'browser'] }, browser: { allowHosts: ['localhost:3000'] } })",
  },
  {
    tool: 'vision.describe',
    purpose: 'Let any model look at an image file (such as a screenshot) through a vision model.',
    enable:
      '`--vision`, `--vision-model <provider/model>` or `--image <path>` (SDK `vision: {}`), with the `read` grant.',
    operations: {
      describe:
        '{path, question}: ask one specific question about a png, jpeg or webp (8 MB at most).',
    },
    limits: [
      'Costs one vision-model call (a few seconds); 20 calls per run; answers are cut at 4,000 characters and marked untrusted.',
      'Refuses a path outside the workspace, a link, a secret-looking name (`.env`, keys), a wrong type or a file over 8 MB.',
      '`--image` itself currently loses the attachment on the server; `vision.describe` on a workspace file is not affected.',
    ],
    failures: [
      {
        message: 'No vision model is available to this account',
        meaning:
          'Name one with `--vision-model provider/model`; the tool never answers from nothing.',
      },
    ],
    cli: 'clawai -p "Does page.png show the Save button fully?" --allow-tools read --vision --workspace ./site',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, vision: { model: 'provider/model' } })",
  },
  {
    tool: 'agent.team',
    purpose:
      'Run other agents in parallel on separate parts of one job, each with less power than the lead.',
    enable: '`--allow-tools agents` (`--max-agents N`, 1 to 8, default 4). Never a default.',
    operations: {
      spawn:
        '{name, task, tools?, writeScope?, budget?, workspaceSubdir?, isolation?, model?}: start a child.',
      message: '{to, text}: send a message (`lead` is the main agent).',
      inbox: '{}: read messages sent to you.',
      wait: '{names?, timeoutMs?}: return when the children are over, a message arrives, or at the timeout (240 s at most).',
      status: '{}: every child, short.',
      result: '{name}: one child’s full report.',
      cancel: '{name}: stop one child.',
    },
    limits: [
      'A child can only have less than its parent: categories, write scope, budget and approvals are inherited and narrowed. Depth 2; 8 children per run.',
      'Two children may not change overlapping files unless one asks for `isolation: "worktree"` (its own git checkout, merged back).',
      'Small tasks cost more with a team: each child is a full run.',
    ],
    failures: [
      {
        message: 'Give each child a disjoint writeScope',
        meaning: 'A second child’s files overlap a child still working.',
      },
    ],
    cli: 'clawai -p "Build modules a, b and c in separate folders, then run all tests" --allow-tools read,write,command,agents --max-agents 3',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'write', 'command', 'agents'] }, maxAgents: 3 })",
  },
];
