import { assertPointInViewport, MAX_TYPED_TEXT_CHARACTERS } from '../core/browser-operation';

import type { PageActionContext } from './playwright-page-actions.types';

/**
 * One function per page-level browser action. The driver looks the handler up
 * by operation name, so each action stays a few lines and adding one does not
 * grow a single dispatcher.
 */

export async function clickAction({ operation, timeout, locate }: PageActionContext) {
  await locate(operation.locator).click({ timeout });
}

export async function fillAction({ operation, timeout, locate }: PageActionContext) {
  await locate(operation.locator).fill(operation.value ?? '', { timeout });
}

export async function selectAction({ operation, timeout, locate }: PageActionContext) {
  await locate(operation.locator).selectOption(operation.values ?? [], { timeout });
}

export async function keyboardAction({ page, operation }: PageActionContext) {
  await page.keyboard.press(operation.value ?? '', { delay: 0 });
}

export async function hoverAction({ operation, timeout, locate }: PageActionContext) {
  await locate(operation.locator).hover({ timeout });
}

export async function dragAction({ operation, timeout, locate }: PageActionContext) {
  await locate(operation.locator).dragTo(locate(operation.targetLocator), { timeout });
}

export async function uploadAction({ upload }: PageActionContext) {
  await upload();
}

export async function clickAtAction({ page, operation }: PageActionContext) {
  const point = assertPointInViewport(operation.point, page.viewportSize() ?? undefined);
  await page.mouse.click(point.x, point.y);
}

export async function typeTextAction({ page, operation }: PageActionContext) {
  const text = operation.value ?? '';
  if (text.length === 0 || text.length > MAX_TYPED_TEXT_CHARACTERS)
    throw new Error('Typed text must be 1 to 4096 characters');
  await page.keyboard.type(text, { delay: 0 });
}

export async function scrollAction({ page, operation }: PageActionContext) {
  const point = assertPointInViewport(operation.point, page.viewportSize() ?? undefined);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(operation.delta?.x ?? 0, operation.delta?.y ?? 0);
}
