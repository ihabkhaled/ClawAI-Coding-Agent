import { defineConfig } from '@playwright/test';

/**
 * The real-editor lane, separate from the webview fixture lane.
 *
 * It needs its own config because nothing here is a browser: there is no
 * baseURL, no web server to start, and a launch costs tens of seconds rather
 * than milliseconds. Sharing one config would either slow the fixture lane down
 * or starve this one of time.
 */
export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  reporter: [['list']],
  retries: 0,
  testDir: './tests/vscode-e2e',
  testMatch: '**/*.e2e.ts',
  // A cold VS Code launch plus extension activation is the slow part, and a
  // timeout shorter than that reports a working editor as a broken one.
  timeout: 180_000,
  workers: 1,
});
