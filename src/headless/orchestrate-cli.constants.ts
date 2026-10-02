export const ORCHESTRATE_COMMAND = 'orchestrate';

/** Flags that stand alone. */
export const ORCHESTRATE_BARE_FLAGS: readonly string[] = [
  '-h',
  '--help',
  '--dry-run',
  '--allow-shell',
];

/** Flags that take a value, each mapped to the field it fills. */
export const ORCHESTRATE_VALUE_FLAGS: Readonly<Record<string, string>> = {
  '--plan': 'plan',
  '--model': 'model',
  '--provider': 'provider',
  '--backend-url': 'backendUrl',
  '--allow-tools': 'allowTools',
  '--allow-command': 'allowCommand',
  '--http-allow-host': 'httpAllowHost',
  '--browser-allow-host': 'browserAllowHost',
  '--shell-deny': 'shellDeny',
  '--permission-mode': 'permissionMode',
  '--output-format': 'outputFormat',
  '--max-parallel': 'maxParallel',
};

export const ORCHESTRATE_OUTPUT_FORMATS: readonly string[] = ['text', 'json', 'stream-json'];

/** The largest plan file the command reads. */
export const ORCHESTRATE_PLAN_MAX_BYTES = 512 * 1024;

export const ORCHESTRATE_USAGE = [
  'Usage: clawai orchestrate --plan <plan.json> [options]',
  '',
  'Runs a plan file: stages as a DAG, each agent a narrowed run with its own scope, budget and checks,',
  'each stage gated by checks the orchestrator runs. See docs/ORCHESTRATION.md.',
  '',
  'Options:',
  '  --plan <file>                The plan (JSON). Required.',
  '  --dry-run                    Validate the plan and print the DAG and the order; start nothing, needs no sign-in.',
  '  --model <id>                 Model for agents that name none (env CLAW_MODEL).',
  '  --provider <id>              Provider connector (env CLAW_PROVIDER).',
  '  --backend-url <url>          Runtime API base (env CLAW_BACKEND_URL).',
  '  --allow-tools <list>         The most any agent may hold (default: read,write,command,git,git-write; plus http and',
  '                               browser when a host flag is given). A plan asking for more is refused before anything runs.',
  '  --allow-command <exe>        Added to the command allowlist (node, npm, npx). Repeatable.',
  "  --http-allow-host <host>     Hosts an agent's http.allowHosts must lie inside. Repeatable.",
  "  --browser-allow-host <host>  Private hosts an agent's browser.allowHosts must lie inside. Repeatable.",
  '  --allow-shell                With shell in --allow-tools and --permission-mode: lets plan agents set shell: true.',
  '  --shell-deny <regex>         Extra refusal pattern for shell scripts. Repeatable.',
  '  --permission-mode <mode>     ask, accept-edits, autonomous-scoped or strict; agents ask the person (denied with no terminal).',
  "  --max-parallel <n>           Overrides the plan's maxParallel (1 to 8).",
  '  --output-format <fmt>        text (default), json (the report), or stream-json (one orchestrate.* event per line).',
  '',
  'Credentials: CLAW_TOKEN, or CLAW_EMAIL and CLAW_PASSWORD. Exit: 0 passed, 1 failed, 2 plan refused, 3 not signed in,',
  '5 timeout, 130 cancelled. The report is <state>/orchestrate/<run>/report.json and report.md.',
  '',
].join('\n');
