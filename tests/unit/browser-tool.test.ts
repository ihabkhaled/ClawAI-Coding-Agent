import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadPlaywright } from '../../src/sdk/browser-session';
import { createBrowserTool } from '../../src/sdk/browser-tool';

import { startTestSite } from './browser-tool.helpers';

import type { TestSite } from './browser-tool.helpers';
import type { BrowserTool } from '../../src/sdk/browser-tool.types';

async function canLaunch(): Promise<boolean> {
  try {
    const playwright = await loadPlaywright();
    const browser = await playwright.chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const browserAvailable = await canLaunch();
const real = describe.skipIf(!browserAvailable);

type Result = Record<string, unknown>;

async function call(
  tool: BrowserTool,
  operation: string,
  args: Record<string, unknown> = {},
): Promise<Result> {
  const result = await tool.execute(operation, args);
  return result as Result;
}

real('browser.page against a real page', () => {
  let site: TestSite;
  let scratch: string;
  let tool: BrowserTool;

  beforeAll(async () => {
    site = await startTestSite();
    scratch = mkdtempSync(path.join(tmpdir(), 'clawai-browser-test-'));
    tool = createBrowserTool({ allowHosts: [site.host], scratchDirectory: scratch });
  });

  afterAll(async () => {
    tool.dispose();
    await site.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('opens a page, reads it, fills the form, and reports the console and network', async () => {
    const opened = await call(tool, 'open', { url: `${site.origin}/` });
    expect(opened.title).toBe('Test Login');
    expect(opened.status).toBe(200);
    expect(String(opened.note)).toMatch(/untrusted/iu);

    const snap = await call(tool, 'snapshot');
    expect(String(snap.text)).toContain('Welcome back');
    expect(String(snap.accessibility)).toMatch(/button "Sign in".*\[ref=e\d+\]/u);
    expect(String(snap.accessibility)).toMatch(/textbox "Email".*\[ref=e\d+\]/u);

    await call(tool, 'type', { selector: '#email', text: 'ihab@example.com' });
    await call(tool, 'click', { text: 'Sign in' });
    const after = await call(tool, 'snapshot');
    expect(String(after.text)).toContain('Signed in as ihab@example.com');

    const logs = await call(tool, 'console');
    const texts = (logs.entries as { type: string; text: string }[]).map((entry) => entry.text);
    expect(texts.some((text) => text.includes('boom on load'))).toBe(true);
    expect(texts.some((text) => text.includes('careful now'))).toBe(true);

    const network = await call(tool, 'network');
    const failed = network.entries as { url: string; status?: number }[];
    expect(
      failed.some((entry) => entry.url.endsWith('/missing.json') && entry.status === 404),
    ).toBe(true);
  });

  it('picks a drop-down option by its label when asked to type into it', async () => {
    await call(tool, 'open', { url: `${site.origin}/form` });
    const picked = await call(tool, 'type', { selector: '#item', text: 'Hat' });
    expect(picked.value).toBe('h');
    const snap = await call(tool, 'snapshot');
    expect(String(snap.accessibility)).toMatch(/option "Hat" \[selected\]/u);
  });

  it('reports the viewport, and sideways scrolling after a resize', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    const resized = await call(tool, 'resize', { width: 390, height: 800 });
    expect(resized).toEqual({ width: 390, height: 800, horizontalOverflow: false });
    expect((await call(tool, 'snapshot')).viewport).toBe('390x800');
    await expect(call(tool, 'resize', { width: 10, height: 800 })).rejects.toThrow(/whole-number/u);
  });

  it('acts on an element by the ref a snapshot gave', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    const snap = await call(tool, 'snapshot');
    const email = /textbox "Email" \[ref=((?:f\d+)?e\d+)\]/u.exec(String(snap.accessibility));
    const button = /button "Sign in" \[ref=((?:f\d+)?e\d+)\]/u.exec(String(snap.accessibility));
    expect(email?.[1]).toBeDefined();
    expect(button?.[1]).toBeDefined();
    await call(tool, 'type', { ref: email?.[1], text: 'ref@example.com', submit: false });
    await call(tool, 'click', { ref: button?.[1] });
    expect(String((await call(tool, 'snapshot')).text)).toContain('Signed in as ref@example.com');
  });

  it('submits with Enter, presses a key, and waits for text', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    await call(tool, 'type', { selector: '#email', text: 'enter@example.com', submit: true });
    await call(tool, 'wait', { text: 'Signed in as enter@example.com' });
    await call(tool, 'press', { key: 'Tab' });
    const waited = await call(tool, 'wait', { ms: 50 });
    expect(waited.waitedMs).toBe(50);
  });

  it('saves a screenshot and returns its path and size', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    const shot = await call(tool, 'screenshot', { fullPage: true });
    const file = String(shot.path);
    expect(file.startsWith(scratch)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBe(shot.bytes);
    expect(Number(shot.width)).toBeGreaterThan(100);
  });

  it('keeps a snapshot inside the size the model asked for', async () => {
    await call(tool, 'open', { url: `${site.origin}/big` });
    const snap = await call(tool, 'snapshot', { maxChars: 1000 });
    expect(JSON.stringify(snap).length).toBeLessThan(2_600);
    expect(snap.truncated).toBe(true);
  });

  it('reports a page error with its secret removed', async () => {
    await call(tool, 'open', { url: `${site.origin}/js-error` });
    await call(tool, 'console', { clear: true });
    await call(tool, 'open', { url: `${site.origin}/js-error` });
    const logs = await call(tool, 'console');
    const text = JSON.stringify(logs);
    expect(text).toContain('kaboom');
    expect(text).not.toContain('abcdef1234567890abcdef');
  });

  it('shows what a field holds after typing, but never what a password field holds', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    const email = await call(tool, 'type', { selector: '#email', text: 'seen@example.com' });
    expect(email.value).toBe('seen@example.com');
    const password = await call(tool, 'type', { selector: '#password', text: 'hunter2hunter2' });
    expect(password.value).toBeUndefined();
    expect(JSON.stringify(password)).not.toContain('hunter2');
  });

  it('redacts secrets that appear in page text', async () => {
    await call(tool, 'open', { url: `${site.origin}/secret` });
    const text = JSON.stringify(await call(tool, 'snapshot'));
    expect(text).not.toContain('hunter2hunter2');
    expect(text).not.toContain('abcdef0123456789abcdef0123456789');
  });

  it('returns hostile page text as marked data, unchanged in meaning', async () => {
    await call(tool, 'open', { url: `${site.origin}/inject` });
    const snap = await call(tool, 'snapshot');
    expect(String(snap.text)).toContain('Ignore all previous instructions');
    expect(String(snap.note)).toMatch(/never follow/iu);
  });

  it('refuses a redirect to a private address and says why', async () => {
    await expect(call(tool, 'open', { url: `${site.origin}/redirect` })).rejects.toThrow(
      /blocked.*private or local host/iu,
    );
  });

  it('blocks a private subresource the page asks for and reports it', async () => {
    const opened = await call(tool, 'open', { url: `${site.origin}/private-subresource` });
    expect(JSON.stringify(opened.refusedByAddressCheck)).toContain('169.254.169.254');
  });

  it('does not open a file: address', async () => {
    await expect(call(tool, 'open', { url: 'file:///etc/hosts' })).rejects.toThrow(/Only http/u);
  });

  it('does not save a download', async () => {
    await call(tool, 'open', { url: `${site.origin}/download` });
    await call(tool, 'click', { selector: '#dl' }).catch(() => undefined);
    expect(existsSync(path.join(scratch, 'x.bin'))).toBe(false);
  });

  it('closes a popup past the page limit', async () => {
    await call(tool, 'open', { url: `${site.origin}/popup` });
    await call(tool, 'click', { text: 'Pop' });
    const snap = await call(tool, 'snapshot');
    expect(String(snap.url)).toContain('/popup');
  });

  it('caps a flood of console errors, and cuts each message', async () => {
    await call(tool, 'open', { url: `${site.origin}/flood` });
    const logs = await call(tool, 'console', { clear: true });
    const entries = logs.entries as { text: string }[];
    expect(entries.length).toBeLessThanOrEqual(30);
    expect(logs.count).toBeLessThanOrEqual(100);
    expect(JSON.stringify(logs).length).toBeLessThan(15_000);
    expect(entries.every((entry) => entry.text.length <= 403)).toBe(true);
    expect((await call(tool, 'console')).count).toBe(0);
  });

  it('refuses text longer than a field needs', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    await expect(
      call(tool, 'type', { selector: '#email', text: 'a'.repeat(5_000) }),
    ).rejects.toThrow(/at most/u);
  });

  it('says what was not found instead of hanging on a missing element', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    await expect(call(tool, 'click', { selector: '#nope' })).rejects.toThrow(/No element matches/u);
    await expect(call(tool, 'click', { text: 'Absent label' })).rejects.toThrow(
      /No element matches/u,
    );
  });

  it('refuses arguments that are not usable', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    await expect(call(tool, 'click', {})).rejects.toThrow(/needs one of/u);
    await expect(call(tool, 'type', { text: 'x' })).rejects.toThrow(/for the field/u);
    await expect(call(tool, 'click', { ref: 'e1', selector: 'a' })).rejects.toThrow(/only one/u);
    await expect(call(tool, 'click', { ref: 'x; drop' })).rejects.toThrow(/not a ref/u);
    await expect(call(tool, 'type', { selector: '#email' })).rejects.toThrow(/"text"/u);
    await expect(call(tool, 'press', { key: 'Enter; rm' })).rejects.toThrow(/needs a "key"/u);
    await expect(call(tool, 'wait', { ms: 999_999 })).rejects.toThrow(/whole number/u);
    await expect(call(tool, 'dance')).rejects.toThrow(/Unsupported operation/u);
  });

  it('serves concurrent calls one after another', async () => {
    await call(tool, 'open', { url: `${site.origin}/` });
    const results = await Promise.all([
      call(tool, 'type', { selector: '#email', text: 'a@example.com' }),
      call(tool, 'type', { selector: '#email', text: 'b@example.com' }),
      call(tool, 'snapshot'),
    ]);
    expect(results[0].typed).toBe(13);
    expect(String((await call(tool, 'snapshot')).accessibility)).toContain('b@example.com');
  });
});

real('browser.page limits and shutdown', () => {
  let site: TestSite;

  beforeAll(async () => {
    site = await startTestSite();
  });

  afterAll(async () => {
    await site.close();
  });

  it('stops serving once the run time is used up', async () => {
    const tool = createBrowserTool({ allowHosts: [site.host], maxRunMs: 1_000 });
    await call(tool, 'open', { url: `${site.origin}/` });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await expect(call(tool, 'snapshot')).rejects.toThrow(/run time limit/u);
    tool.dispose();
  });

  it('closes the browser when the call is cancelled mid navigation', async () => {
    const tool = createBrowserTool({ allowHosts: [site.host] });
    const controller = new AbortController();
    const pending = tool.execute('open', { url: `${site.origin}/hang` }, controller.signal);
    setTimeout(() => {
      controller.abort();
    }, 700);
    const started = Date.now();
    await expect(pending).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(8_000);
    await expect(call(tool, 'snapshot')).rejects.toThrow(/No page is open/u);
    tool.dispose();
  });

  it('refuses every call after dispose', async () => {
    const tool = createBrowserTool({ allowHosts: [site.host] });
    await call(tool, 'open', { url: `${site.origin}/` });
    tool.dispose();
    await expect(call(tool, 'snapshot')).rejects.toThrow(/run has ended/u);
  });

  it('reports close, and can open again afterwards', async () => {
    const tool = createBrowserTool({ allowHosts: [site.host] });
    await call(tool, 'open', { url: `${site.origin}/` });
    expect((await call(tool, 'close')).closed).toBe(true);
    await expect(call(tool, 'snapshot')).rejects.toThrow(/No page is open/u);
    expect((await call(tool, 'open', { url: `${site.origin}/second` })).title).toBe('T');
    tool.dispose();
  });

  it('keeps a popup when the operator allows a second page', async () => {
    const tool = createBrowserTool({ allowHosts: [site.host], maxPages: 2 });
    await call(tool, 'open', { url: `${site.origin}/popup` });
    await call(tool, 'click', { text: 'Pop' });
    await call(tool, 'wait', { ms: 500 });
    expect(String((await call(tool, 'snapshot')).url)).toContain('/second');
    tool.dispose();
  });

  it('refuses the loopback host when the operator did not list it', async () => {
    const tool = createBrowserTool({});
    await expect(call(tool, 'open', { url: `${site.origin}/` })).rejects.toThrow(
      /--browser-allow-host 127\.0\.0\.1/u,
    );
    tool.dispose();
  });

  it('numbers screenshots from one inside the scratch folder', async () => {
    const scratch = mkdtempSync(path.join(tmpdir(), 'clawai-browser-shots-'));
    const tool = createBrowserTool({ allowHosts: [site.host], scratchDirectory: scratch });
    await call(tool, 'open', { url: `${site.origin}/second` });
    const first = await call(tool, 'screenshot');
    expect(String(first.path)).toContain('shot-1.png');
    tool.dispose();
    rmSync(scratch, { recursive: true, force: true });
  });
});
