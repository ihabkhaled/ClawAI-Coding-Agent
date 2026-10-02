import { describe, expect, it, vi } from 'vitest';

import { agentToolkit } from '../../src/sdk/agent-toolkit';
import { createBrowserTool } from '../../src/sdk/browser-tool';
import { BROWSER_MISSING_MESSAGE } from '../../src/sdk/browser-tool.constants';
import { browserToolDefinition, browserToolkit } from '../../src/sdk/browser-toolkit';
import { permissionsForMode } from '../../src/sdk/permission-modes';
import { combineToolkits } from '../../src/sdk/toolkit-compose';

import type { AgentToolCall } from '../../src/sdk/agent-sdk.types';
import type { PlaywrightLoader } from '../../src/sdk/browser-session.types';
import type { AgentApprovalRequest } from '../../src/sdk/workspace-toolkit.types';

const ALL = ['read', 'write', 'command', 'git', 'git-write', 'mcp', 'browser'] as const;

const callOf = (operation: string, args: Record<string, unknown> = {}): AgentToolCall => ({
  toolName: 'browser.page',
  operation,
  arguments: args,
});

const request = (operation: string): AgentApprovalRequest => ({
  ...callOf(operation),
  category: 'browser',
});

const config = (allow: readonly (typeof ALL)[number][]) => ({
  auth: { token: 't' },
  workspaceRoot: process.cwd(),
  permissions: { allow },
});

describe('browser tool offering', () => {
  it('is offered only with the browser grant', () => {
    const without = agentToolkit(config(['read', 'git']));
    expect(JSON.stringify(without.definitions)).not.toContain('browser.page');
    const withGrant = agentToolkit(config(['read', 'browser']));
    expect(JSON.stringify(withGrant.definitions)).toContain('browser.page');
    without.dispose?.();
    withGrant.dispose?.();
  });

  it('lists every operation the model may use, and the right risk classes', () => {
    expect(browserToolDefinition.operations).toEqual([
      'open',
      'snapshot',
      'click',
      'type',
      'press',
      'wait',
      'screenshot',
      'resize',
      'console',
      'network',
      'close',
    ]);
    expect(browserToolDefinition.riskClasses).toContain('browser');
  });

  it('keeps the definition small enough to send on every turn', () => {
    expect(JSON.stringify(browserToolDefinition).length).toBeLessThan(2_200);
  });

  it('refuses a call for an operation it does not have, and for another tool', async () => {
    const toolkit = browserToolkit({}, { allow: ['browser'] });
    expect(await toolkit.authorize?.(callOf('dance'))).toBe(false);
    expect(await toolkit.authorize?.({ ...callOf('open'), toolName: 'browser.other' })).toBe(false);
    expect(await toolkit.authorize?.(callOf('open'))).toBe(true);
    toolkit.dispose?.();
  });

  it('refuses everything when the grant is missing, even if the model guesses the name', async () => {
    const toolkit = browserToolkit({}, { allow: ['read'] });
    expect(toolkit.definitions).toEqual([]);
    expect(await toolkit.authorize?.(callOf('open', { url: 'https://example.com' }))).toBe(false);
    toolkit.dispose?.();
  });

  it('puts every call to the approval callback when one is given, and a refusal denies it', async () => {
    const approve = vi.fn(() => false);
    const toolkit = browserToolkit({}, { allow: ['browser'], approve });
    expect(await toolkit.authorize?.(callOf('open'))).toBe(false);
    expect(approve).toHaveBeenCalledTimes(1);
    toolkit.dispose?.();
  });

  it('routes browser.page through a combined toolkit and denies a tool nobody offers', async () => {
    const combined = combineToolkits([browserToolkit({}, { allow: ['browser'] })]);
    expect(await combined.authorize?.(callOf('snapshot'))).toBe(true);
    expect(await combined.authorize?.({ ...callOf('snapshot'), toolName: 'browser.ghost' })).toBe(
      false,
    );
    combined.dispose?.();
  });
});

describe('browser tool under permission modes', () => {
  async function decide(mode: Parameters<typeof permissionsForMode>[0], operation: string) {
    const asked = vi.fn(() => true);
    const permissions = permissionsForMode(mode, { allow: [...ALL], approve: asked });
    const toolkit = browserToolkit({}, permissions);
    const allowed = (await toolkit.authorize?.(callOf(operation))) === true;
    toolkit.dispose?.();
    return { allowed, asked: asked.mock.calls.length > 0 };
  }

  it('plan mode offers no browser at all', () => {
    const permissions = permissionsForMode('plan', { allow: [...ALL] });
    expect(permissions.allow).not.toContain('browser');
    const toolkit = agentToolkit({ ...config([...ALL]), permissionMode: 'plan' });
    expect(JSON.stringify(toolkit.definitions)).not.toContain('browser.page');
    toolkit.dispose?.();
  });

  it.each(['ask', 'accept-edits', 'strict'] as const)(
    '%s asks before acting on a page',
    async (mode) => {
      for (const operation of ['open', 'click', 'type', 'press']) {
        expect(await decide(mode, operation)).toEqual({ allowed: true, asked: true });
      }
    },
  );

  it('autonomous-scoped lets the run work inside the hosts the operator allowed', async () => {
    for (const operation of ['open', 'click', 'type', 'press', 'snapshot']) {
      expect(await decide('autonomous-scoped', operation)).toEqual({ allowed: true, asked: false });
    }
  });

  it.each(['ask', 'accept-edits', 'autonomous-scoped'] as const)(
    '%s never asks about looking at the page',
    async (mode) => {
      for (const operation of ['snapshot', 'screenshot', 'console', 'network', 'wait', 'close']) {
        expect(await decide(mode, operation)).toEqual({ allowed: true, asked: false });
      }
    },
  );

  it('denies an acting call when nobody can be asked', async () => {
    const permissions = permissionsForMode('ask', { allow: [...ALL] });
    expect(await permissions.approve?.(request('open'))).toBe(false);
    expect(await permissions.approve?.(request('snapshot'))).toBe(true);
  });

  it('strict asks even for what autonomous-scoped runs, and never for a look', async () => {
    const permissions = permissionsForMode('strict', { allow: [...ALL], approve: () => false });
    expect(await permissions.approve?.(request('open'))).toBe(false);
    expect(await permissions.approve?.(request('screenshot'))).toBe(true);
  });
});

describe('browser tool without a browser', () => {
  const missing: PlaywrightLoader = () => Promise.reject(new Error(BROWSER_MISSING_MESSAGE));

  it('tells the model how to install Playwright when the package is absent', async () => {
    const tool = createBrowserTool({ allowHosts: ['127.0.0.1'] }, missing);
    await expect(tool.execute('open', { url: 'http://127.0.0.1:1/' })).rejects.toThrow(
      /npm install playwright-core.*CLAW_BROWSER_PATH/su,
    );
    tool.dispose();
  });

  it('explains a missing browser binary without leaking the launcher dump', async () => {
    const loader: PlaywrightLoader = () =>
      Promise.resolve({
        chromium: {
          launch: () =>
            Promise.reject(
              new Error(
                "browserType.launch: Executable doesn't exist at /secret/path\n  lots of text",
              ),
            ),
        },
      });
    const tool = createBrowserTool({ allowHosts: ['127.0.0.1'] }, loader);
    const failure = tool.execute('open', { url: 'http://127.0.0.1:1/' });
    await expect(failure).rejects.toThrow(/npx playwright-core install chromium/u);
    await expect(tool.execute('open', { url: 'http://127.0.0.1:1/' })).rejects.not.toThrow(
      /secret\/path/u,
    );
    tool.dispose();
  });

  it('checks the address before it ever starts a browser', async () => {
    const launched = vi.fn(missing);
    const tool = createBrowserTool({}, launched);
    await expect(tool.execute('open', { url: 'http://127.0.0.1:1/' })).rejects.toThrow(/private/u);
    await expect(tool.execute('open', { url: 'file:///etc/passwd' })).rejects.toThrow(/Only http/u);
    expect(launched).not.toHaveBeenCalled();
    tool.dispose();
  });

  it('says to open a page first when a page operation comes before open', async () => {
    const tool = createBrowserTool({}, missing);
    await expect(tool.execute('snapshot', {})).rejects.toThrow(/open \{url\} first/u);
    tool.dispose();
  });
});
