import type { HeadlessOutputFormat } from './headless-args.types';
import type { AgentToolCategory } from '../sdk/workspace-toolkit.types';

export const HEADLESS_OUTPUT_FORMATS: readonly HeadlessOutputFormat[] = [
  'text',
  'json',
  'stream-json',
];

export const HEADLESS_TOOL_CATEGORIES: readonly AgentToolCategory[] = [
  'read',
  'write',
  'command',
  'git',
  'git-write',
  'mcp',
];

/** Ceilings for the run guards; past them a number is a typo, not a budget. */
/** How long the process may take to drain sockets before it is ended with its exit code. */
export const HEADLESS_EXIT_GRACE_MS = 3000;
export const HEADLESS_MAX_TOOL_CALLS = 10_000;
export const HEADLESS_MAX_DURATION_SECONDS = 86_400;

/**
 * What the CLI asks for when `--budget` and `--auto-continue` are absent. The
 * SDK's own defaults stay `default` and 0: a script that calls the library has
 * chosen its cost, a person at a terminal has chosen a task.
 */
export const HEADLESS_BUDGET_PROFILE_DEFAULT = 'long';
export const HEADLESS_AUTO_CONTINUE_DEFAULT = 3;

/** Flags that stand alone. */
export const HEADLESS_BARE_FLAGS: readonly string[] = [
  '-h',
  '--help',
  '--json',
  '--continue',
  '--use-memory',
  '--no-memory',
];

/** Flags that take a value, each mapped to the field it fills. */
export const HEADLESS_VALUE_FLAGS: Readonly<Record<string, string>> = {
  '-p': 'prompt',
  '--prompt': 'prompt',
  '--model': 'model',
  '--provider': 'provider',
  '--workspace': 'workspace',
  '--backend-url': 'backendUrl',
  '--allow-tools': 'allowTools',
  '--allow-command': 'allowCommand',
  '--output-format': 'outputFormat',
  '--max-turns': 'maxTurns',
  '--resume': 'resume',
  '--append-system-prompt': 'appendSystemPrompt',
  '--system-prompt-file': 'systemPromptFile',
  '--mcp-config': 'mcpConfig',
  '--mcp-login': 'mcpLogin',
  '--mcp-token-file': 'mcpTokenFile',
  '--max-tool-calls': 'maxToolCalls',
  '--max-duration': 'maxDuration',
  '--budget': 'budgetProfile',
  '--auto-continue': 'autoContinue',
  '--permission-mode': 'permissionMode',
  '--allowed-tools': 'allowedTools',
  '--disallowed-tools': 'disallowedTools',
  '--write-scope': 'writeScope',
  '--write-deny': 'writeDeny',
  '--done-check': 'doneCheck',
  '--done-check-file': 'doneCheckFile',
};

export const HEADLESS_USAGE = [
  'Usage: clawai -p "<prompt>" [options]',
  '',
  'Options:',
  '  -p, --prompt <text>          The task. Required.',
  '  --model <id>                 Model to run (env CLAW_MODEL).',
  '  --provider <id>              Provider connector (env CLAW_PROVIDER).',
  '  --workspace <dir>            Directory the tools are confined to (default: cwd).',
  '  --backend-url <url>          Runtime API base (env CLAW_BACKEND_URL).',
  '  --allow-tools <list>         Comma list of read,write,command,git,git-write,mcp (default: read,git;',
  '                               with --mcp-config, read,git,mcp; with --permission-mode, all).',
  '  --allowed-tools <globs>      Comma list of tool patterns to allow, e.g. workspace.file.*,',
  '                               mcp__echo__*. Empty means no restriction. Repeatable.',
  '  --disallowed-tools <globs>   Tool patterns to refuse. Deny wins over allow. Repeatable.',
  '  --write-scope <globs>        Confine every file and git change to these workspace-relative globs',
  '                               (* in a segment, ** across, ?). Comma list, repeatable. Reads are free.',
  '  --write-deny <globs>         Globs no change may match; wins over --write-scope. Repeatable.',
  '  --done-check <l>=<cmd args>  Completion check the ORCHESTRATOR defines: run when the model says it is done',
  '                               (no shell; double or single quotes group words). Exit 0 = pass. A failure continues the',
  '                               run (up to --auto-continue), then fails with DONE_CHECKS_FAILED. Repeatable.',
  '  --done-check-file <file>     JSON array of { label, executable, args[], cwd?, timeoutMs? } checks.',
  '  --permission-mode <mode>     plan (read-only) | ask (approve every write, command and MCP',
  '                               call) | accept-edits (approve commands and MCP calls only).',
  '                               Approvals are asked on a terminal; with none, they are denied.',
  '  --resume <threadId>          Continue an existing thread.',
  '  --continue                   Continue the most recent CLI thread for this workspace.',
  '  --append-system-prompt <t>   Operator instructions, text or @file (added to the runtime instructions).',
  '  --system-prompt-file <file>  Operator instructions read from a file; --append follows it.',
  '  --mcp-config <file>          JSON file of MCP servers ({"mcpServers": {...}}).',
  '  --mcp-login <server>         Sign in to an OAuth MCP server from --mcp-config; no -p needed.',
  '  --mcp-token-file <file>      Token file: --mcp-login writes it; a run reads it, in memory only.',
  '  --allow-command <name>       Add an executable to the command allowlist; repeatable.',
  '  --output-format <fmt>        text | json | stream-json (default: text).',
  '  --max-turns <n>              Model-turn budget for the run.',
  '  --max-tool-calls <n>         Stop the run (exit 5) after n tool calls.',
  '  --max-duration <seconds>     Stop the run (exit 5) after this many seconds, in total.',
  '  --budget <profile>           default | long (default: long). The run budget requested from the',
  '                               server; long is its maximum (100 turns, 500 calls, 1 MiB of results).',
  '                               Your --max-* guards are the real limit; the server budget is a ceiling.',
  '  --auto-continue <n>          When a run ends on the SERVER budget, start up to n new runs on the same',
  '                               thread (0-20, default 3). --max-tool-calls and --max-duration are totals.',
  '  --use-memory                 Keep the account personal memories on a NEW thread. Default: off, so a',
  '                               coding run is deterministic. --no-memory is that default (a no-op).',
  '  -h, --help                   Show this help.',
  '',
  'Auth: CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD. Never printed.',
  'Exit codes: 0 success, 1 run failed, 2 usage error, 3 auth error,',
  '            4 permission denied, 5 budget exhausted, 130 aborted.',
  '',
].join('\n');
