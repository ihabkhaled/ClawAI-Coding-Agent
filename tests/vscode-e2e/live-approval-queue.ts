import { appendFileSync } from 'node:fs';
import path from 'node:path';

import type { Frame, Page } from 'playwright';

/** What the scenario needs from the live lane that owns the editor session. */
export interface ApprovalQueueContext {
  readonly chat: Frame;
  readonly window: Page;
  readonly out: string;
  readonly slug: string;
  readonly firstPrompt: string;
  readonly secondPrompt: string;
  readonly shot: (name: string) => Promise<void>;
  /** Clicks a pending Approve in whichever chat view shows it. */
  readonly approve: () => Promise<boolean>;
  readonly waitForEnd: (chat: Frame) => Promise<string>;
}

const NEWLINE = String.fromCharCode(10);
const APPROVAL_WAIT_MS = 180_000;

async function approvalShowing(window: Page): Promise<boolean> {
  for (const frame of window.frames()) {
    if (!frame.url().includes('vscode-webview')) continue;
    for (const child of frame.childFrames()) {
      if (
        await child
          .locator('#approvalApprove')
          .isVisible({ timeout: 300 })
          .catch(() => false)
      ) {
        return true;
      }
    }
  }
  return false;
}

async function waitForApproval(window: Page): Promise<boolean> {
  const deadline = Date.now() + APPROVAL_WAIT_MS;
  while (Date.now() < deadline) {
    if (await approvalShowing(window)) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

/** The sidebar as a person sees it: the Chat view and every section below it. */
async function sidebarShot(context: ApprovalQueueContext, name: string): Promise<string> {
  const sidebar = context.window.locator('.part.sidebar').first();
  const box = await sidebar.boundingBox().catch(() => null);
  await sidebar
    .screenshot({ path: path.join(context.out, `${context.slug}-${name}-sidebar.png`) })
    .catch(() => undefined);
  const chatBox = await context.window
    .locator('.split-view-view .webview, .webview')
    .first()
    .boundingBox()
    .catch(() => null);
  return `${name}: sidebar ${String(box?.height ?? '?')}px tall, first webview ${String(chatBox?.height ?? '?')}px`;
}

/**
 * The defect found live: a second message sent while a run waits for approval
 * queues behind it. Records what the second card says and how tall the Chat
 * view is, before and after the send, then approves so the run can finish.
 */
export async function approvalQueueScenario(context: ApprovalQueueContext): Promise<string> {
  const { chat } = context;
  const notes: string[] = [];
  await chat.locator('#prompt').fill(context.firstPrompt, { timeout: 15_000 });
  await chat.locator('#prompt').press('Control+Enter', { timeout: 15_000 });
  const waiting = await waitForApproval(context.window);
  notes.push(`approval request appeared: ${String(waiting)}`);
  await context.shot(`${context.slug}-1-approval-waiting`);
  notes.push(await sidebarShot(context, 'before-send'));

  await chat.locator('#prompt').fill(context.secondPrompt, { timeout: 15_000 });
  await chat.locator('#prompt').press('Control+Enter', { timeout: 15_000 });
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  await context.shot(`${context.slug}-2-second-sent`);
  notes.push(await sidebarShot(context, 'after-send'));
  const cards = await chat.locator('.message-assistant .message-body').allInnerTexts();
  notes.push(`second card text: ${JSON.stringify(cards.at(-1) ?? '')}`);
  notes.push(`waiting list: ${JSON.stringify(await chat.locator('.waiting-run').allInnerTexts())}`);

  await context.approve();
  const text = await context.waitForEnd(chat);
  await context.shot(`${context.slug}-3-finished`);
  appendFileSync(path.join(context.out, `${context.slug}-approval-queue.txt`), notes.join(NEWLINE));
  return text;
}
