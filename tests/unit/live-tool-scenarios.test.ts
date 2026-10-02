import { describe, expect, it } from 'vitest';

import {
  TOOL_SCENARIOS,
  scenarioChecks,
  toolScenario,
} from '../../tests/vscode-e2e/live-tool-scenarios';

describe('live tool scenarios', () => {
  it('names the three scenarios a later session can rerun', () => {
    expect(Object.keys(TOOL_SCENARIOS).sort()).toEqual([
      'approval-cards',
      'plan-gates',
      'server-browser',
    ]);
    expect(toolScenario('approval-queue')).toBeUndefined();
  });

  it('turns the opt-in tools on through user settings only for the scenarios that need them', () => {
    expect(TOOL_SCENARIOS['approval-cards']?.settings).toMatchObject({
      'clawAI.tools.shellEnabled': true,
    });
    expect(TOOL_SCENARIOS['server-browser']?.settings).toMatchObject({
      'clawAI.tools.httpAllowHosts': ['127.0.0.1:4180'],
    });
    expect(TOOL_SCENARIOS['server-browser']?.settings).not.toHaveProperty(
      'clawAI.tools.shellEnabled',
    );
    expect(TOOL_SCENARIOS['plan-gates']?.settings).toEqual({});
  });

  it('every prompt works in the per-model folder', () => {
    for (const scenario of Object.values(TOOL_SCENARIOS)) {
      expect(scenario.prompt).toContain('{dir}');
    }
  });

  it('passes when the cards show the script and fails when they only show the effect class', () => {
    const scenario = TOOL_SCENARIOS['approval-cards'];
    if (scenario === undefined) throw new Error('missing scenario');
    const good = scenarioChecks(
      scenario,
      'the heading is card check',
      [
        'Run a shell script\nnode --version && echo shell-card-check',
        'Open a page in the browser\n127.0.0.1',
      ].join('\n'),
      '.',
    );
    expect(good.failed).toBe(false);
    const bad = scenarioChecks(scenario, 'card check', 'local-mutation\ntarget:workspace', '.');
    expect(bad.failed).toBe(true);
    expect(bad.lines.filter((line) => line.startsWith('FAIL'))).toHaveLength(4);
  });
});

describe('a provider failure', () => {
  it('fails the scenario instead of counting as a pass', () => {
    const scenario = TOOL_SCENARIOS['server-browser'];
    if (scenario === undefined) throw new Error('missing scenario');
    const result = scenarioChecks(
      scenario,
      'first items boom from the page (PROVIDER_CREDIT_EXHAUSTED)',
      '127.0.0.1',
      '.',
    );
    expect(result.lines).toContain('FAIL panel: the run did not end in a provider error');
  });
});
