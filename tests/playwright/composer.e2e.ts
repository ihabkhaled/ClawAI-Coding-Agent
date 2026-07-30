import { expect, test } from '@playwright/test';

import { localModel, sendState, type MockBridge } from './fixtures';

import type { Page } from '@playwright/test';

declare global {
  interface Window {
    __clawMock: MockBridge;
    __finishAttachmentRead?: () => void;
  }
}

const browserIssues = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const issues: string[] = [];
  browserIssues.set(page, issues);
  page.on('pageerror', (error) => {
    issues.push(error.message);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      issues.push(message.text());
    }
  });
  await page.goto('/');
  await sendState(page);
});

test.afterEach(async ({ page }) => {
  expect(browserIssues.get(page)).toEqual([]);
});

test('recalls submitted prompts with ArrowUp and walks forward with ArrowDown', async ({
  page,
}) => {
  const prompt = page.locator('#prompt');
  const composer = page.locator('#composer');

  await prompt.fill('Inspect the workspace');
  await composer.evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  await prompt.fill('Run the focused tests');
  await composer.evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await expect(prompt).toHaveValue('');
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveValue('Run the focused tests');
  await prompt.press('ArrowUp');
  await expect(prompt).toHaveValue('Inspect the workspace');
  await prompt.press('ArrowDown');
  await expect(prompt).toHaveValue('Run the focused tests');
  await prompt.press('ArrowDown');
  await expect(prompt).toHaveValue('');
});

test('snapshots the selected model into a prompt sent immediately after changing it', async ({
  page,
}) => {
  await page.locator('#modelSelect').selectOption(localModel.key);
  await page.locator('#prompt').fill('Create the selected-model file');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      content: 'Create the selected-model file',
      contextMode: 'smart',
      researchMode: 'NONE',
      modelKey: localModel.key,
      requestId: expect.any(String),
    });
});

test('pastes screenshots and files into the composer and sends immutable attachment bytes', async ({
  page,
}) => {
  await page.locator('#prompt').evaluate((prompt) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([99, 108, 97, 119])], 'screen.png', { type: 'image/png' }),
    );
    prompt.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: transfer,
      }),
    );
  });

  await expect(page.locator('#attachmentList')).toContainText('screen.png');
  await page.locator('#prompt').fill('Explain this screenshot');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });

  await expect
    .poll(() => page.evaluate(() => window.__clawMock.messages.at(-1)))
    .toEqual({
      type: 'agent',
      attachments: [
        {
          clientId: expect.any(String),
          content: 'Y2xhdw==',
          filename: 'screen.png',
          mimeType: 'image/png',
          sizeBytes: 4,
        },
      ],
      content: 'Explain this screenshot',
      contextMode: 'smart',
      researchMode: 'NONE',
      modelKey: 'AUTO',
      requestId: expect.any(String),
    });
  await expect(page.locator('.message-user').last()).toContainText('screen.png');
  await expect(page.locator('#attachmentList')).toBeEmpty();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(window.__clawMock.state)))
    .not.toContain('Y2xhdw==');
});

test('keeps clipboard text paste available while attaching clipboard files', async ({ page }) => {
  const defaultPrevented = await page.locator('#prompt').evaluate((prompt) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Please inspect this screenshot');
    transfer.items.add(new File(['image'], 'screen.png', { type: 'image/png' }));
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    });
    prompt.dispatchEvent(event);
    return event.defaultPrevented;
  });

  expect(defaultPrevented).toBe(false);
  await expect(page.locator('#attachmentList')).toContainText('screen.png');
});

test('queues rapid paste batches instead of silently dropping the second file', async ({
  page,
}) => {
  await page.locator('#prompt').evaluate((prompt) => {
    const batches: [string, string][] = [
      ['first.txt', 'first'],
      ['second.txt', 'second'],
    ];
    for (const [filename, content] of batches) {
      const transfer = new DataTransfer();
      transfer.items.add(new File([content], filename, { type: 'text/plain' }));
      prompt.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          clipboardData: transfer,
        }),
      );
    }
  });

  await expect(page.locator('#attachmentList')).toContainText('first.txt');
  await expect(page.locator('#attachmentList')).toContainText('second.txt');
  await expect(page.locator('.attachment-chip')).toHaveCount(2);
});

test('accepts a dropped video and renders it without forcing the file picker', async ({ page }) => {
  await page.locator('#composer').evaluate((composer) => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112])], 'demo.mp4', {
        type: 'video/mp4',
      }),
    );
    composer.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        dataTransfer: transfer,
      }),
    );
  });

  await expect(page.locator('#attachmentList')).toContainText('demo.mp4');
  await expect(page.locator('#attachmentList')).toContainText('8 B');
});

test('adds files with the picker, renders an accessible chip, and removes them', async ({
  page,
}) => {
  await expect(page.locator('#attachmentInput')).toHaveAttribute(
    'accept',
    /image\/png.*video\/mp4/u,
  );
  await page.locator('#attachmentInput').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('private composer bytes'),
  });

  const chip = page.locator('.attachment-chip');
  await expect(chip).toContainText('notes.txt');
  await expect(chip).toContainText('22 B');
  await expect(chip.getByRole('button', { name: 'Remove notes.txt' })).toBeVisible();

  await chip.getByRole('button', { name: 'Remove notes.txt' }).click();
  await expect(page.locator('#attachmentList')).toBeEmpty();
  await expect(page.locator('#attachmentTray')).toBeHidden();
});

test('rejects empty and unsupported files before adding composer chips', async ({ page }) => {
  await page.locator('#attachmentInput').setInputFiles({
    name: 'empty.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(0),
  });
  await expect(page.locator('#attachmentStatus')).toHaveText('Empty files cannot be attached.');
  await expect(page.locator('#attachmentList')).toBeEmpty();

  await page.locator('#attachmentInput').setInputFiles({
    name: 'unsupported.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('audio'),
  });
  await expect(page.locator('#attachmentStatus')).toHaveText('This file type is not supported.');
  await expect(page.locator('#attachmentList')).toBeEmpty();
  await expect(page.locator('#prompt')).toBeFocused();
});

test('rejects oversized attachments before reading their bytes', async ({ page }) => {
  await page.locator('#attachmentInput').setInputFiles({
    name: 'too-large.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1),
  });

  await expect(page.locator('#attachmentStatus')).toHaveText(
    'Each attachment must be 25 MiB or smaller.',
  );
  await expect(page.locator('#attachmentList')).toBeEmpty();
});

test('keeps Send disabled when state refreshes during an attachment read', async ({ page }) => {
  await page.evaluate(() => {
    class DeferredFileReader {
      error: DOMException | null = null;
      result: string | ArrayBuffer | null = null;
      private readonly listeners = new Map<string, EventListener>();

      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, listener);
      }

      readAsDataURL(): void {
        window.__finishAttachmentRead = () => {
          this.result = 'data:text/plain;base64,c2xvdw==';
          this.listeners.get('load')?.(new Event('load'));
        };
      }
    }
    Object.defineProperty(window, 'FileReader', {
      configurable: true,
      value: DeferredFileReader,
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File(['slow'], 'slow.txt', { type: 'text/plain' }));
    document.querySelector('#prompt')?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: transfer,
      }),
    );
  });

  await expect(page.locator('#sendButton')).toBeDisabled();
  await sendState(page);
  await expect(page.locator('#sendButton')).toBeDisabled();

  await page.evaluate(() => window.__finishAttachmentRead?.());
  await expect(page.locator('#sendButton')).toBeEnabled();
  await expect(page.locator('#attachmentList')).toContainText('slow.txt');
});

test('shows attachment ownership in the request queue', async ({ page }) => {
  await page.locator('#attachmentInput').setInputFiles({
    name: 'queued.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('queued'),
  });
  await page.locator('#prompt').fill('Inspect the queued file');
  await page.locator('#composer').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
  });
  const request = (await page.evaluate(() => window.__clawMock.messages.at(-1))) as {
    requestId: string;
  };

  await sendState(page, {
    busy: true,
    generationQueue: {
      active: [],
      capacity: 2,
      pending: [
        {
          concurrencyKey: 'chat-a',
          id: request.requestId,
          kind: 'agent',
          modelLabel: 'Qwen 2.5 Coder 7B',
          prompt: 'Inspect the queued file',
        },
      ],
    },
  });

  await expect(page.locator('.waiting-run')).toContainText('1 attachment · 6 B');
});

test('clears account-bound draft attachments and ignores a late file read', async ({ page }) => {
  await page.locator('#attachmentInput').setInputFiles({
    name: 'account-a.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('account a'),
  });
  await page.locator('#prompt').fill('Account A draft');
  await expect(page.locator('#attachmentList')).toContainText('account-a.txt');

  await page.evaluate(() => {
    window.__clawMock.send({ type: 'accountReset' });
  });
  await expect(page.locator('#prompt')).toHaveValue('');
  await expect(page.locator('#attachmentList')).toBeEmpty();

  await page.evaluate(() => {
    class DeferredFileReader {
      error: DOMException | null = null;
      result: string | ArrayBuffer | null = null;
      private readonly listeners = new Map<string, EventListener>();

      addEventListener(type: string, listener: EventListener): void {
        this.listeners.set(type, listener);
      }

      readAsDataURL(): void {
        window.__finishAttachmentRead = () => {
          this.result = 'data:text/plain;base64,bGF0ZQ==';
          this.listeners.get('load')?.(new Event('load'));
        };
      }
    }
    Object.defineProperty(window, 'FileReader', {
      configurable: true,
      value: DeferredFileReader,
    });
    const transfer = new DataTransfer();
    transfer.items.add(new File(['late'], 'late.txt', { type: 'text/plain' }));
    document.querySelector('#prompt')?.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: transfer,
      }),
    );
    window.__clawMock.send({ type: 'accountReset' });
    window.__finishAttachmentRead?.();
  });

  await expect(page.locator('#attachmentList')).toBeEmpty();
  await expect(page.locator('#attachmentTray')).toBeHidden();
});
