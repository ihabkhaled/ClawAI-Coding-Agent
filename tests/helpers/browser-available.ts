import { loadPlaywright } from '../../src/sdk/browser-session';

/** Whether a real headless Chromium can start here; CI containers without one skip the real-browser tests. */
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

export const browserAvailable = await canLaunch();
