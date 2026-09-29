import { describe, expect, it, vi } from 'vitest';

import { PAGE_ACTION_HANDLERS } from '../../src/infrastructure/playwright-page-actions.constants';

import type { BrowserOperation } from '../../src/core/browser-operation';
import type { PageActionContext } from '../../src/infrastructure/playwright-page-actions.types';
import type { Locator, Page } from 'playwright-core';

function context(operation: Partial<BrowserOperation>, upload = vi.fn(async () => undefined)) {
  const typed: string[] = [];
  const page = {
    keyboard: {
      type: async (text: string) => {
        typed.push(text);
      },
    },
  } as Page;
  const value: PageActionContext = {
    page,
    operation: { sessionId: 'session-12345', timeoutMs: 1_000, ...operation } as BrowserOperation,
    timeout: 1_000,
    locate: () => ({}) as Locator,
    upload,
  };
  return { value, typed, upload };
}

describe('PAGE_ACTION_HANDLERS', () => {
  it('maps every page action the driver dispatches and nothing else', () => {
    expect(Object.keys(PAGE_ACTION_HANDLERS).sort()).toEqual(
      [
        'click',
        'click-at',
        'drag',
        'fill',
        'hover',
        'keyboard',
        'scroll',
        'select',
        'type-text',
        'upload',
      ].sort(),
    );
  });

  it('refuses empty typed text before touching the page', async () => {
    const { value, typed } = context({ operation: 'type-text', value: '' });
    await expect(PAGE_ACTION_HANDLERS['type-text']?.(value)).rejects.toThrow(
      'Typed text must be 1 to 4096 characters',
    );
    expect(typed).toEqual([]);
  });

  it('types bounded text into the page', async () => {
    const { value, typed } = context({ operation: 'type-text', value: 'hello' });
    await PAGE_ACTION_HANDLERS['type-text']?.(value);
    expect(typed).toEqual(['hello']);
  });

  it('delegates upload to the driver', async () => {
    const { value, upload } = context({ operation: 'upload' });
    await PAGE_ACTION_HANDLERS.upload?.(value);
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
