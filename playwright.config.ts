import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 5_000,
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  fullyParallel: false,
  reporter: [['list']],
  testDir: './tests/playwright',
  testMatch: '**/*.e2e.ts',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    colorScheme: 'dark',
    contextOptions: {
      reducedMotion: 'reduce',
    },
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/serve-webview-fixture.mjs',
    port: 4178,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
