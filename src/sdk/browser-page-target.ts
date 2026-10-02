import type { BrowserTarget } from './browser-session.types';
import type { Locator, Page } from 'playwright-core';

const REF_PATTERN = /^(?:f\d{1,3})?e\d{1,6}$/u;

function given(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** The one element the model named: a snapshot ref, a CSS selector, or visible text. */
export function targetFrom(
  args: Readonly<Record<string, unknown>>,
  operation: string,
  options: { readonly allowText: boolean },
): BrowserTarget {
  const ref = given(args.ref)?.replace(/^\[?ref=|\]$/gu, '');
  const selector = given(args.selector);
  const text = options.allowText ? given(args.text) : undefined;
  const named = [ref, selector, text].filter((value) => value !== undefined).length;
  if (named === 0) {
    throw new Error(
      `browser.page ${operation} needs ${options.allowText ? 'one of "ref" (from snapshot), "selector" or "text"' : 'a "ref" (from snapshot) or a "selector" for the field'}.`,
    );
  }
  if (named > 1)
    throw new Error(`browser.page ${operation} takes only one of ref, selector, text.`);
  if (ref !== undefined) {
    if (!REF_PATTERN.test(ref)) throw new Error(`"${ref}" is not a ref like e12 from snapshot.`);
    return { kind: 'ref', value: ref };
  }
  if (selector !== undefined) return { kind: 'selector', value: selector };
  return { kind: 'text', value: text ?? '' };
}

/** A label tried as a button, then a link, then any visible text. */
async function byLabel(page: Page, label: string): Promise<Locator> {
  const candidates = [
    page.getByRole('button', { name: label }),
    page.getByRole('link', { name: label }),
    page.getByLabel(label),
    page.getByPlaceholder(label),
    page.getByText(label),
  ];
  for (const candidate of candidates) {
    if ((await candidate.count()) > 0) return candidate;
  }
  return candidates[candidates.length - 1] ?? page.getByText(label);
}

/** The matching elements, never throwing for none: the caller words that failure. */
export async function locate(page: Page, target: BrowserTarget): Promise<Locator> {
  if (target.kind === 'ref') return page.locator(`aria-ref=${target.value}`);
  if (target.kind === 'selector') return page.locator(target.value);
  return byLabel(page, target.value);
}

/** How a target is named in an error, so the model sees what it asked for. */
export function describeTarget(target: BrowserTarget): string {
  return target.kind === 'ref'
    ? `ref ${target.value}`
    : `${target.kind} "${target.value.slice(0, 80)}"`;
}
