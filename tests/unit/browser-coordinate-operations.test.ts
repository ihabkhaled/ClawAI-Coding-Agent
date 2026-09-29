import { describe, expect, it } from 'vitest';

import {
  assertPointInViewport,
  boundObservedElements,
  browserOperationSchema,
  MAX_OBSERVED_ELEMENTS,
} from '../../src/core/browser-operation';
import { BrowserControllerService } from '../../src/services/browser-controller-service';

import type { BrowserOperation } from '../../src/core/browser-operation';

const viewport = { width: 1000, height: 800 };

describe('assertPointInViewport', () => {
  it('accepts a point inside the viewport', () => {
    expect(assertPointInViewport({ x: 10, y: 20 }, viewport)).toEqual({ x: 10, y: 20 });
  });

  it('refuses rather than clamps a point outside it', () => {
    expect(() => assertPointInViewport({ x: 1000, y: 5 }, viewport)).toThrow('outside');
    expect(() => assertPointInViewport({ x: 5, y: 800 }, viewport)).toThrow('outside');
  });

  it('refuses a missing point or viewport', () => {
    expect(() => assertPointInViewport(undefined, viewport)).toThrow('point');
    expect(() => assertPointInViewport({ x: 1, y: 1 }, undefined)).toThrow('viewport');
  });
});

describe('boundObservedElements', () => {
  const element = (x: number, y: number, name = 'Save') => ({
    role: 'button',
    name,
    x,
    y,
    width: 40.4,
    height: 20,
  });

  it('drops hidden, empty and off-screen boxes', () => {
    const kept = boundObservedElements(
      [element(5, 5), element(-1, 5), element(5, 900), { ...element(5, 5), width: 0 }],
      viewport,
      (text) => text,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]?.width).toBe(40);
  });

  it('caps the count and redacts names', () => {
    const many = Array.from({ length: 200 }, () => element(1, 1, 'x'.repeat(500)));
    const kept = boundObservedElements(many, viewport, (text) => `[${String(text.length)}]`);
    expect(kept).toHaveLength(MAX_OBSERVED_ELEMENTS);
    expect(kept[0]?.name).toBe('[120]');
  });
});

describe('coordinate operation schema', () => {
  const base = { sessionId: 'session-12345' };

  it('accepts click-at, scroll, type-text and observe', () => {
    for (const operation of ['click-at', 'scroll', 'type-text', 'observe'] as const) {
      expect(
        browserOperationSchema.parse({ ...base, operation, point: { x: 1, y: 2 } }).operation,
      ).toBe(operation);
    }
  });

  it('rejects fractional, negative and oversized coordinates', () => {
    const parse = (point: unknown): unknown =>
      browserOperationSchema.safeParse({ ...base, operation: 'click-at', point }).success;
    expect(parse({ x: 1.5, y: 2 })).toBe(false);
    expect(parse({ x: -1, y: 2 })).toBe(false);
    expect(parse({ x: 10_001, y: 2 })).toBe(false);
  });

  it('bounds the scroll delta', () => {
    const parse = (delta: unknown): unknown =>
      browserOperationSchema.safeParse({ ...base, operation: 'scroll', delta }).success;
    expect(parse({ x: 0, y: 5_000 })).toBe(true);
    expect(parse({ x: 0, y: 5_001 })).toBe(false);
  });
});

describe('BrowserControllerService with coordinate operations', () => {
  it('is paused for click-at during user takeover and forwards it otherwise', async () => {
    const seen: BrowserOperation[] = [];
    const service = new BrowserControllerService(
      {
        execute: (operation) => {
          seen.push(operation);
          return Promise.resolve({
            consoleFailures: [],
            networkFailures: [],
            accessibilityViolations: 0,
            structured: { completed: operation.operation },
          });
        },
        disposeSession: () => Promise.resolve(),
      },
      () => ({
        allowedOrigins: [],
        allowExternalNavigationWithApproval: false,
        allowDownloads: false,
        maxDownloadBytes: 1,
      }),
      { approveOrigin: () => Promise.resolve(false) },
    );
    const click = { sessionId: 'session-12345', operation: 'click-at', point: { x: 3, y: 4 } };
    await service.execute(click);
    expect(seen[0]?.point).toEqual({ x: 3, y: 4 });
    await service.execute({ sessionId: 'session-12345', operation: 'takeover' });
    await expect(service.execute(click)).rejects.toThrow('paused');
  });
});
