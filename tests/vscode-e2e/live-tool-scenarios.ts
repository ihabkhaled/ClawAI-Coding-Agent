import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Scenarios for the real-editor live lane that exercise the opt-in tools:
 * `http.request`, `workspace.shell`, the browser, the plan and the gate runner.
 *
 * Select one with `CLAW_LIVE_SCENARIO=<name>`. Each brings the user settings it
 * needs (written to the throwaway profile's USER settings, which is the only
 * scope the opt-in tools honour), an approval mode, a prompt, and checks that are
 * recorded in `scenario-checks.txt`. `cards` checks run against the text of the
 * approval cards the lane saw, so a card that goes back to showing
 * "local-mutation" instead of the script fails the scenario, not just a human.
 *
 * Live model capacity is limited: one scenario at a time, and stop after two
 * consecutive 429 / 402 answers. See docs/LIVE_TOOL_SCENARIOS.md.
 */
export interface ToolScenario {
  /** Use `{dir}` for the per-model folder inside the workspace. */
  readonly prompt: string;
  readonly approval: string;
  /** User settings merged over the lane's own, e.g. `clawAI.tools.httpAllowHosts`. */
  readonly settings: Readonly<Record<string, unknown>>;
  /** What the final panel text must show; a miss is recorded, and fails the scenario. */
  readonly panel: readonly { readonly label: string; readonly pattern: RegExp }[];
  /** What the approval cards (all of them, joined) must have shown. */
  readonly cards: readonly { readonly label: string; readonly pattern: RegExp }[];
  /** Optional check of what ended up on disk; returns a line for the checks file. */
  readonly verify?: (directory: string) => string;
}

/** A run that ended on the provider (credit, rate limit) proves nothing about the tools. */
const PROVIDER_OK = /^(?![\s\S]*(?:PROVIDER_CREDIT_EXHAUSTED|RATE_LIMIT|HTTP 429))/u;
const SERVER_PORT = 4180;
const SERVER_ORIGIN = `http://127.0.0.1:${String(SERVER_PORT)}`;

const TOOL_SETTINGS = {
  'clawAI.tools.httpAllowHosts': [`127.0.0.1:${String(SERVER_PORT)}`],
  'clawAI.browserOrigins': [SERVER_ORIGIN],
} as const;

function runIn(directory: string, args: readonly string[]): string {
  const result = spawnSync('node', [...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return `exit ${String(result.status)}: ${result.stdout.trim().split('\n').slice(-3).join(' | ')}`;
}

export const TOOL_SCENARIOS: Readonly<Record<string, ToolScenario>> = {
  /** (a) start a local server, test its API, open it in the browser, report console errors. */
  'server-browser': {
    approval: 'AUTO_EDIT',
    settings: TOOL_SETTINGS,
    prompt:
      `In the folder {dir}, create server.js: a plain node http server on 127.0.0.1 port ${String(SERVER_PORT)} ` +
      'with GET /api/items returning the JSON [{"id":1,"name":"first"}], and GET / returning an HTML page ' +
      'whose inline script runs console.error("boom from the page"). Start it in the background with ' +
      `workspace.command, test GET ${SERVER_ORIGIN}/api/items with the http.request tool, then open ` +
      `${SERVER_ORIGIN}/ with the workspace.browser tool, read the browser console, and report the console ` +
      'errors you saw. Stop the server at the end.',
    panel: [
      { label: 'the run did not end in a provider error', pattern: PROVIDER_OK },
      { label: 'the API answered', pattern: /first|items/iu },
      { label: 'the page console error was reported', pattern: /boom from the page/iu },
    ],
    cards: [{ label: 'a browser navigation card names the host', pattern: /127\.0\.0\.1/u }],
  },

  /** (b) a flagship brief that has to plan and run the project's gates before finishing. */
  'plan-gates': {
    approval: 'AUTO_EDIT',
    settings: {},
    prompt:
      'Flagship brief. In the folder {dir}, build a small word-frequency module: src/wordfreq.js exporting ' +
      'countWords(text) (lower-case words to counts), src/wordfreq.test.js using node:test and node:assert, and ' +
      'a package.json with the scripts "test": "node --test" and "lint": "node --check src/wordfreq.js". ' +
      'Keep a task list with workspace.planning set-tasks and update it as you go. Before you finish you MUST ' +
      'run the project gates with the workspace.quality tool (discover, then run) and report their results; ' +
      'do not say you are done until they pass.',
    panel: [
      { label: 'the run did not end in a provider error', pattern: PROVIDER_OK },
      { label: 'a plan was kept', pattern: /plan|task/iu },
      { label: 'gates were run and reported', pattern: /quality|gate|test/iu },
    ],
    cards: [],
    verify: (directory) => `node --test in the folder: ${runIn(directory, ['--test'])}`,
  },

  /** (c) the approval cards for a shell script and for a browser open must be readable. */
  'approval-cards': {
    approval: 'ASK',
    settings: { ...TOOL_SETTINGS, 'clawAI.tools.shellEnabled': true },
    prompt:
      'Do exactly these steps and nothing else. 1) With the workspace.shell tool run this script: ' +
      'node --version && echo shell-card-check. 2) In the folder {dir} create server.js, a node http server on ' +
      `127.0.0.1 port ${String(SERVER_PORT)} that answers "<h1>card check</h1>" to GET /, and start it in the ` +
      `background with workspace.command. 3) Open ${SERVER_ORIGIN}/ with the workspace.browser tool and report ` +
      'the page heading. 4) Stop the server.',
    panel: [
      { label: 'the run did not end in a provider error', pattern: PROVIDER_OK },
      { label: 'the page heading was read', pattern: /card check/iu },
    ],
    cards: [
      { label: 'the shell card names the action', pattern: /Run a shell script/u },
      {
        label: 'the shell card shows the script',
        pattern: /node --version && echo shell-card-check/u,
      },
      { label: 'the browser card says what it opens', pattern: /Open a page in the browser/u },
      { label: 'the browser card names the host', pattern: /127\.0\.0\.1/u },
    ],
  },
};

/** The scenario named by `CLAW_LIVE_SCENARIO`, or undefined for the lane's own scenarios. */
export function toolScenario(name: string): ToolScenario | undefined {
  return TOOL_SCENARIOS[name];
}

/** The lines of `scenario-checks.txt`: one per check, PASS or FAIL, so a rerun is easy to diff. */
export function scenarioChecks(
  scenario: ToolScenario,
  panelText: string,
  cardText: string,
  directory: string,
): { readonly lines: readonly string[]; readonly failed: boolean } {
  const lines: string[] = [];
  let failed = false;
  const judge = (source: string, label: string, pattern: RegExp, text: string): void => {
    const ok = pattern.test(text);
    if (!ok) failed = true;
    lines.push(`${ok ? 'PASS' : 'FAIL'} ${source}: ${label}`);
  };
  for (const check of scenario.panel) judge('panel', check.label, check.pattern, panelText);
  for (const check of scenario.cards) judge('card', check.label, check.pattern, cardText);
  if (scenario.verify !== undefined) lines.push(scenario.verify(path.resolve(directory)));
  return { lines, failed };
}
