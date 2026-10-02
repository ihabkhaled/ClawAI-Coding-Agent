import type { ToolNote } from './tools-doc.types';

/** The tools every run can have: files, commands, git, notes, the shell, the web and MCP. */
export const CORE_TOOL_NOTES: readonly ToolNote[] = [
  {
    tool: 'workspace.file',
    purpose: 'Read, search, create, change, delete and move files inside the workspace folder.',
    enable: 'On by default (`read`); changing files needs `--allow-tools read,write`.',
    operations: {
      read: '{path, startLine?, endLine?, maxChars?}: lines of a file; follow `nextLine` to continue.',
      list: '{path?, recursive?, depth?}: entries with type and size (max 400).',
      glob: '{pattern, path?}: file paths matching `**/*.ts` (max 500).',
      search: '{query | regex, path?, include?, caseSensitive?}: matching lines (max 100).',
      stat: '{path}: exists, type, size, modified time.',
      create: '{path, content}: write a whole file; overwrites; makes folders.',
      update: '{path, oldText, newText, expectedCount?, replaceAll?}: exact text replace.',
      delete: '{path}: delete one file.',
      rename: '{path, to}: move a file or folder; fails if the target exists.',
    },
    limits: [
      'A read returns 8,000 characters by default (48,000 at most) and is cut at a line.',
      'Binary files are refused. Search skips files over 1 MB.',
      'Every path must stay inside the workspace; `--write-scope` and `--write-deny` narrow changes further.',
    ],
    failures: [
      {
        message: 'was not found in',
        meaning:
          '`update` copied text that is not in the file. Read the file again and copy it exactly.',
      },
      {
        message: 'If this file really needs to change, say so in your final report',
        meaning: 'The path is outside `--write-scope`; the message lists the paths it may change.',
      },
    ],
    cli: 'clawai -p "Add a failing test for the parser" --allow-tools read,write --write-scope "src/**,tests/**"',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'write'] } })",
  },
  {
    tool: 'workspace.command',
    purpose:
      'Run one program (no shell) and read its exit code and output; long jobs can run in the background.',
    enable:
      '`--allow-tools command` (add programs with `--allow-command`; default `node`, `npm`, `npx`).',
    operations: {
      run: '{executable, arguments[], cwd?, timeoutMs?, maxOutputChars?, background?}: run and wait, or start in the background.',
      output: '{processId, sinceOffset?}: read what a background process printed.',
      wait: '{processId, timeoutMs?}: block until it ends (600,000 ms at most).',
      stop: '{processId}: kill it and its children.',
    },
    limits: [
      'Default timeout 120 s, maximum 30 minutes; a timeout kills the whole process tree.',
      'Output keeps the first 4,000 characters and the end (24,000 in all, 48,000 at most).',
      'At most 4 background processes; all die when the run ends.',
      'The environment is filtered: no tokens, no `CLAW_*` or `AWS_*` values.',
    ],
    failures: [
      {
        message: 'Commands run WITHOUT a shell',
        meaning:
          'The program is not allowed, or an argument was only shell syntax (`|`, `>`, `&&`).',
      },
    ],
    cli: 'clawai -p "Run the unit tests and fix what fails" --allow-tools read,write,command --allow-command pytest',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissions: { allow: ['read', 'write', 'command'] } })",
  },
  {
    tool: 'workspace.git',
    purpose:
      'Look at the repository, and (with a second grant) stage, commit, fetch, pull, push and switch branches.',
    enable:
      'Reads are on by default (`git`); everything that changes a repository needs `git-write`.',
    operations: {
      status: '{}: changed files and the current branch.',
      diff: '{path?, staged?}: the working-tree or staged diff.',
      log: '{maxCount?, path?}: recent commits.',
      show: '{ref?}: one commit.',
      remote: '{}: remotes, with URL credentials removed.',
      branch: '{}: branches.',
      add: '{paths[]}: stage named files (never `.` or a wildcard).',
      unstage: '{paths[]}: unstage named files.',
      commit:
        '{message, body?, trailers?}: commit with the repository hooks; one-line message of 100 characters at most.',
      fetch: '{}: fetch from origin.',
      pull: '{}: rebase pull from origin; a conflict is reported and the rebase aborted.',
      push: '{branch?}: send HEAD to origin; never forced.',
      switch: '{branch, create?}: change branch; never discards changes.',
      restore: '{paths[]}: restore named files in the working tree.',
    },
    limits: [
      'Arguments are fixed per operation: no `--no-verify`, `--force`, `--delete` or tags can be passed.',
      'Hooks run for real; commit, fetch, pull and push wait 30 minutes (`timeoutSeconds` up to 3,600).',
      'With `--write-scope`, a commit that holds a path outside the scope is refused.',
    ],
    failures: [
      {
        message: 'the staged set has paths outside the write scope',
        meaning: 'A commit that holds a path outside `--write-scope`; nothing is committed.',
      },
    ],
    cli: 'clawai -p "Commit the change with a clear message" --allow-tools read,write,git,git-write --permission-mode ask',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissionMode: 'ask', permissions: { allow: ['read', 'git', 'git-write'], approve } })",
  },
  {
    tool: 'workspace.notes',
    purpose:
      'The agent’s own working memory, so a long run does not re-read what it already learned.',
    enable: 'On by default (`read`).',
    operations: {
      add: '{text, tag?}: save a short note (2,000 characters at most).',
      read: '{tag?, query?}: every note, or the matching ones.',
      replace: '{id, text}: rewrite a note.',
      remove: '{id}: delete a note.',
      clear: '{}: delete all notes.',
    },
    limits: [
      'At most 200 notes and 64 KB per conversation; secrets are redacted before they are stored.',
      'Kept outside the workspace (`<state-dir>/notes`), so they cannot be committed. Notes survive `--resume`.',
    ],
    failures: [],
    cli: 'clawai -p "Read the module, note its public names, then add the missing tests" --allow-tools read,write',
    sdk: 'createAgent({ auth: { token }, workspaceRoot: dir })  // notes come with the defaults',
  },
  {
    tool: 'workspace.shell',
    purpose:
      'Run a real shell script (pipes, `&&`, redirects, globs) when one program is not enough.',
    enable:
      'OFF by default. Needs BOTH `--allow-tools shell` and `--allow-shell`, plus a `--permission-mode`.',
    operations: {
      run: '{script, shell?: bash|sh|powershell|cmd, cwd?, timeoutMs?}: run one script.',
    },
    limits: [
      'Every script is put to the approval callback, in every permission mode; with nobody to ask it is denied.',
      'A static screen refuses obviously dangerous scripts before asking. It is a safety net, not a sandbox.',
      'Default timeout 120 s, maximum 30 minutes; output keeps its start and its end; the environment is filtered.',
      'Every script and its exit code are logged (redacted) to `<state-dir>/shell.log`.',
    ],
    failures: [
      {
        message: 'workspace.shell refused (',
        meaning:
          'The screen blocked the script. The message names the rule and the reason; the operator is not asked.',
      },
      {
        message: 'found no shell on this machine',
        meaning: 'Neither bash, sh, PowerShell nor cmd was found.',
      },
    ],
    cli: 'clawai -p "Build and run the tests" --allow-tools read,write,command,shell --allow-shell --permission-mode accept-edits --shell-deny "docker\\s+push"',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, permissionMode: 'ask', permissions: { allow: ['read', 'shell'], shell: {}, approve } })",
  },
  {
    tool: 'workspace.web',
    purpose: 'Search the web and read pages, through the ClawAI research service.',
    enable:
      '`--research search|search-fetch|search-extract` (SDK `research`). No grant is needed: web calls are reads.',
    operations: {
      search: '{query}: ranked results with titles, URLs and snippets.',
      fetch: '{url}: the cleaned text of one page.',
      crawl: '{url, maxPages?, maxDepth?}: read pages of the same site by following links.',
      extract: '{url}: one page with its final address, content type and links split by site.',
    },
    limits: [
      '`search` offers `search`; `search-fetch` adds `fetch` and `crawl`; `search-extract` adds `extract`.',
      '`crawl` reads 10 pages by default (30 at most) and 2 link hops (3 at most), the same host only.',
      'Everything returned is marked untrusted. A call the mode does not offer is refused, not run.',
    ],
    failures: [],
    cli: 'clawai -p "Find the current Node LTS version and write it in NOTES.md" --allow-tools read,write --research search-fetch',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, research: 'SEARCH_FETCH' })",
  },
  {
    tool: 'runtime.mcp',
    purpose: 'Use tools from MCP servers you configured.',
    enable:
      '`--mcp-config <file>` (adds the `mcp` grant); sign in to OAuth servers first with `--mcp-login`.',
    operations: {
      servers: '{}: the configured servers, with any that policy refused.',
      tools: '{server}: that server’s tools and their input schemas.',
      call: '{server, tool, arguments, timeoutMs?}: run one tool.',
    },
    limits: [
      'A `policy` block (`allow`/`deny` by name, command or url) decides which servers may start; a broken policy denies everything.',
      'Results are marked untrusted. Server processes are closed when the run ends.',
      '`call` is asked about in every permission mode except `plan`, which removes it.',
    ],
    failures: [],
    cli: 'clawai -p "Look up the ticket and summarise it" --mcp-config ci/mcp.json --allowed-tools "mcp__tickets__get*"',
    sdk: "createAgent({ auth: { token }, workspaceRoot: dir, mcp: { config: { mcpServers: { echo: { command: 'node', args: ['server.mjs'] } } } } })",
  },
];
