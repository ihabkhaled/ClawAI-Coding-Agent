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
  'mcp',
];

/** Flags that stand alone. */
export const HEADLESS_BARE_FLAGS: readonly string[] = ['-h', '--help', '--json', '--continue'];

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
  '--permission-mode': 'permissionMode',
  '--allowed-tools': 'allowedTools',
  '--disallowed-tools': 'disallowedTools',
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
  '  --allow-tools <list>         Comma list of read,write,command,git,mcp (default: read,git;',
  '                               with --mcp-config, read,git,mcp; with --permission-mode, all).',
  '  --allowed-tools <globs>      Comma list of tool patterns to allow, e.g. workspace.file.*,',
  '                               mcp__echo__*. Empty means no restriction. Repeatable.',
  '  --disallowed-tools <globs>   Tool patterns to refuse. Deny wins over allow. Repeatable.',
  '  --permission-mode <mode>     plan (read-only) | ask (approve every write, command and MCP',
  '                               call) | accept-edits (approve commands and MCP calls only).',
  '                               Approvals are asked on a terminal; with none, they are denied.',
  '  --resume <threadId>          Continue an existing thread.',
  '  --continue                   Continue the most recent CLI thread for this workspace.',
  '  --append-system-prompt <t>   Operator instructions, text or @file (added to the runtime instructions).',
  '  --system-prompt-file <file>  Operator instructions read from a file; --append follows it.',
  '  --mcp-config <file>          JSON file of MCP servers ({"mcpServers": {...}}).',
  '  --allow-command <name>       Add an executable to the command allowlist; repeatable.',
  '  --output-format <fmt>        text | json | stream-json (default: text).',
  '  --max-turns <n>              Model-turn budget for the run.',
  '  -h, --help                   Show this help.',
  '',
  'Auth: CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD. Never printed.',
  'Exit codes: 0 success, 1 run failed, 2 usage error, 3 auth error,',
  '            4 permission denied, 5 budget exhausted, 130 aborted.',
  '',
].join('\n');
