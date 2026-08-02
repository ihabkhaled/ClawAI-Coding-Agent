import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import {
  hashBrowserArtifact,
  type BrowserLocator,
  type BrowserOperation,
  type BrowserScope,
} from '../core/browser-operation';
import { redactText } from '../core/redaction';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type {
  BrowserDriverPort,
  BrowserDriverResult,
} from '../services/browser-controller-service';
import type { Browser, BrowserContext, Locator, Page } from 'playwright-core';

type AriaRole = Parameters<Page['getByRole']>[0];

interface BrowserSession {
  readonly browser: Browser;
  readonly contexts: Map<string, BrowserContext>;
  readonly pages: Map<string, Page>;
  readonly consoleFailures: string[];
  readonly networkFailures: string[];
}

export class PlaywrightBrowserDriver implements BrowserDriverPort {
  private readonly sessions = new Map<string, BrowserSession>();

  constructor(
    private readonly files: VscodeFileTransactionAdapter,
    private readonly artifactRoot: string,
  ) {
    if (!isAbsolute(artifactRoot)) throw new Error('Browser artifact root must be absolute');
  }

  async execute(
    operation: BrowserOperation,
    scope: BrowserScope,
    signal?: AbortSignal,
  ): Promise<BrowserDriverResult> {
    signal?.throwIfAborted();
    if (operation.operation === 'launch') return this.launch(operation);
    const session = this.requireSession(operation.sessionId);
    if (operation.operation === 'close') {
      await this.disposeSession(operation.sessionId);
      return this.result(session, undefined, { closed: true });
    }
    if (operation.operation === 'new-context') return this.newContext(session, operation, scope);
    if (operation.operation === 'close-context') return this.closeContext(session, operation);
    if (operation.operation === 'new-tab') return this.newTab(session, operation);
    if (operation.operation === 'close-tab') return this.closeTab(session, operation);
    const page = this.requirePage(session, operation.pageId);
    return this.executePageOperation(session, page, operation, scope, signal);
  }

  async disposeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return;
    this.sessions.delete(sessionId);
    await session.browser.close();
  }

  private async launch(operation: BrowserOperation): Promise<BrowserDriverResult> {
    if (this.sessions.has(operation.sessionId)) throw new Error('Browser session already exists');
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: false });
    const session: BrowserSession = {
      browser,
      contexts: new Map(),
      pages: new Map(),
      consoleFailures: [],
      networkFailures: [],
    };
    this.sessions.set(operation.sessionId, session);
    return this.result(session, undefined, { launched: true });
  }

  private async newContext(
    session: BrowserSession,
    operation: BrowserOperation,
    scope: BrowserScope,
  ): Promise<BrowserDriverResult> {
    const contextId = operation.contextId ?? `context:${randomUUID()}`;
    if (session.contexts.has(contextId)) throw new Error('Browser context already exists');
    const context = await session.browser.newContext({
      acceptDownloads: scope.allowDownloads,
      viewport: operation.viewport ?? { width: 1440, height: 900 },
    });
    session.contexts.set(contextId, context);
    return this.result(session, undefined, { contextId });
  }

  private async closeContext(
    session: BrowserSession,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const context = this.requireContext(session, operation.contextId);
    for (const [pageId, page] of session.pages) {
      if (page.context() === context) session.pages.delete(pageId);
    }
    session.contexts.delete(operation.contextId ?? '');
    await context.close();
    return this.result(session, undefined, { contextClosed: true });
  }

  private async newTab(
    session: BrowserSession,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const context = this.requireContext(session, operation.contextId);
    const pageId = operation.pageId ?? `page:${randomUUID()}`;
    if (session.pages.has(pageId)) throw new Error('Browser page already exists');
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') session.consoleFailures.push(redactText(message.text()));
    });
    page.on('pageerror', (error) => session.consoleFailures.push(redactText(error.message)));
    page.on('requestfailed', (request) => {
      session.networkFailures.push(
        redactText(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`),
      );
    });
    session.pages.set(pageId, page);
    return this.result(session, page, { pageId });
  }

  private async closeTab(
    session: BrowserSession,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const page = this.requirePage(session, operation.pageId);
    session.pages.delete(operation.pageId ?? '');
    await page.close();
    return this.result(session, undefined, { pageClosed: true });
  }

  private async executePageOperation(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
    scope: BrowserScope,
    signal?: AbortSignal,
  ): Promise<BrowserDriverResult> {
    const timeout = operation.timeoutMs;
    if (operation.operation === 'navigate') {
      if (operation.url === undefined) throw new Error('Browser navigation requires a URL');
      await page.goto(operation.url, { timeout, waitUntil: 'domcontentloaded' });
      return this.result(session, page, { url: page.url() });
    }
    if (operation.operation === 'snapshot') {
      return this.result(session, page, {
        snapshot: await page.locator('body').ariaSnapshot({ timeout }),
      });
    }
    if (operation.operation === 'locate') {
      const locator = this.locator(page, operation.locator);
      return this.result(session, page, { count: await locator.count() });
    }
    const actionOperations = new Set([
      'click',
      'fill',
      'select',
      'keyboard',
      'hover',
      'drag',
      'upload',
    ]);
    if (actionOperations.has(operation.operation)) {
      await this.executePageAction(page, operation, timeout);
      signal?.throwIfAborted();
      return this.result(session, page, { completed: operation.operation });
    }
    return this.executePageObservation(session, page, operation, scope);
  }

  private async executePageAction(
    page: Page,
    operation: BrowserOperation,
    timeout: number,
  ): Promise<void> {
    if (operation.operation === 'click')
      await this.locator(page, operation.locator).click({ timeout });
    else if (operation.operation === 'fill')
      await this.locator(page, operation.locator).fill(operation.value ?? '', { timeout });
    else if (operation.operation === 'select')
      await this.locator(page, operation.locator).selectOption(operation.values ?? [], { timeout });
    else if (operation.operation === 'keyboard')
      await page.keyboard.press(operation.value ?? '', { delay: 0 });
    else if (operation.operation === 'hover')
      await this.locator(page, operation.locator).hover({ timeout });
    else if (operation.operation === 'drag')
      await this.locator(page, operation.locator).dragTo(
        this.locator(page, operation.targetLocator),
        { timeout },
      );
    else if (operation.operation === 'upload') await this.upload(page, operation);
    else throw new Error('Unsupported browser action');
  }

  private async executePageObservation(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
    scope: BrowserScope,
  ): Promise<BrowserDriverResult> {
    if (operation.operation === 'download') return this.download(session, page, operation, scope);
    if (operation.operation === 'screenshot') return this.screenshot(session, page, operation);
    if (operation.operation === 'pdf') return this.pdf(session, page, operation);
    if (operation.operation === 'console')
      return this.result(session, page, { consoleFailures: session.consoleFailures });
    if (operation.operation === 'network')
      return this.result(session, page, { networkFailures: session.networkFailures });
    if (operation.operation === 'storage') return this.storage(session, page);
    if (operation.operation === 'trace-start') {
      await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
      return this.result(session, page, { completed: operation.operation });
    }
    if (operation.operation === 'trace-stop') return this.stopTrace(session, page, operation);
    if (operation.operation === 'video')
      return this.result(session, page, {
        video: 'Video recording is configured when the isolated context is created.',
      });
    if (operation.operation === 'accessibility') return this.accessibility(session, page);
    if (operation.operation === 'measure-layout')
      return this.measureLayout(session, page, operation);
    throw new Error('Unsupported browser page operation');
  }

  private locator(page: Page, locator: BrowserLocator | undefined): Locator {
    if (locator === undefined) throw new Error('Browser operation requires a locator');
    if (locator.kind === 'role')
      return page.getByRole(locator.role as AriaRole, {
        ...(locator.name === undefined ? {} : { name: locator.name }),
        exact: locator.exact,
      });
    if (locator.kind === 'label') return page.getByLabel(locator.value, { exact: locator.exact });
    if (locator.kind === 'test-id') return page.getByTestId(locator.value);
    if (locator.kind === 'text') return page.getByText(locator.value, { exact: locator.exact });
    return page.locator(locator.value);
  }

  private async upload(page: Page, operation: BrowserOperation): Promise<void> {
    const rootKey = operation.contextId;
    if (rootKey === undefined) throw new Error('Upload requires a workspace root key as contextId');
    const paths: string[] = [];
    for (const relativePath of operation.relativePaths ?? []) {
      paths.push((await this.files.uriFor(rootKey, relativePath, 'read')).fsPath);
    }
    await this.locator(page, operation.locator).setInputFiles(paths);
  }

  private async download(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
    scope: BrowserScope,
  ): Promise<BrowserDriverResult> {
    const artifactPath = this.artifactPath(operation);
    const downloadPromise = page.waitForEvent('download', { timeout: operation.timeoutMs });
    await this.locator(page, operation.locator).click({ timeout: operation.timeoutMs });
    const download = await downloadPromise;
    await mkdir(dirname(artifactPath.absolute), { recursive: true });
    await download.saveAs(artifactPath.absolute);
    const bytes = await readFile(artifactPath.absolute);
    if (bytes.byteLength > scope.maxDownloadBytes) {
      throw new Error('Browser download exceeded the active byte limit');
    }
    return this.result(
      session,
      page,
      { suggestedFilename: download.suggestedFilename() },
      artifactPath.relative,
      hashBrowserArtifact(bytes),
    );
  }

  private async screenshot(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const artifactPath = this.artifactPath(operation);
    const bytes = await page.screenshot({ fullPage: operation.fullPage, type: 'png' });
    await mkdir(dirname(artifactPath.absolute), { recursive: true });
    await writeFile(artifactPath.absolute, bytes);
    return this.result(
      session,
      page,
      { screenshot: true },
      artifactPath.relative,
      hashBrowserArtifact(bytes),
    );
  }

  private async pdf(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const artifactPath = this.artifactPath(operation);
    const bytes = await page.pdf({ printBackground: true });
    await mkdir(dirname(artifactPath.absolute), { recursive: true });
    await writeFile(artifactPath.absolute, bytes);
    return this.result(
      session,
      page,
      { pdf: true },
      artifactPath.relative,
      hashBrowserArtifact(bytes),
    );
  }

  private async stopTrace(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const artifactPath = this.artifactPath(operation);
    await mkdir(dirname(artifactPath.absolute), { recursive: true });
    await page.context().tracing.stop({ path: artifactPath.absolute });
    const bytes = await readFile(artifactPath.absolute);
    return this.result(
      session,
      page,
      { trace: true },
      artifactPath.relative,
      hashBrowserArtifact(bytes),
    );
  }

  private async storage(session: BrowserSession, page: Page): Promise<BrowserDriverResult> {
    const state = await page.context().storageState();
    return this.result(session, page, {
      origins: state.origins.map(({ origin }) => origin),
      cookieCount: state.cookies.length,
    });
  }

  private async accessibility(session: BrowserSession, page: Page): Promise<BrowserDriverResult> {
    const violations = await page.locator('body').evaluate((body) => {
      const imagesWithoutAlt = body.querySelectorAll('img:not([alt])').length;
      const unnamedControls = [
        ...body.querySelectorAll('button,input,select,textarea,a[href]'),
      ].filter(
        (element) =>
          !(
            element.getAttribute('aria-label') ??
            element.getAttribute('aria-labelledby') ??
            element.textContent.trim()
          ),
      ).length;
      return { imagesWithoutAlt, unnamedControls, total: imagesWithoutAlt + unnamedControls };
    });
    return this.result(
      session,
      page,
      { accessibility: violations },
      undefined,
      undefined,
      violations.total,
    );
  }

  private async measureLayout(
    session: BrowserSession,
    page: Page,
    operation: BrowserOperation,
  ): Promise<BrowserDriverResult> {
    const measurements = await this.locator(page, operation.locator).evaluateAll((elements) =>
      elements.map((element) => {
        const rectangle = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          x: rectangle.x,
          y: rectangle.y,
          width: rectangle.width,
          height: rectangle.height,
          display: style.display,
          gap: style.gap,
          padding: style.padding,
          color: style.color,
          backgroundColor: style.backgroundColor,
        };
      }),
    );
    return this.result(session, page, { measurements });
  }

  private artifactPath(operation: BrowserOperation): {
    readonly absolute: string;
    readonly relative: string;
  } {
    if (operation.artifactPath === undefined)
      throw new Error('Browser artifact operation requires artifactPath');
    const absolute = resolve(this.artifactRoot, operation.sessionId, operation.artifactPath);
    const boundary = relative(this.artifactRoot, absolute);
    if (boundary.startsWith('..') || isAbsolute(boundary))
      throw new Error('Browser artifact escaped its isolated root');
    return {
      absolute,
      relative: join(operation.sessionId, operation.artifactPath).replaceAll('\\', '/'),
    };
  }

  private requireSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) throw new Error('Browser session is unavailable');
    return session;
  }

  private requireContext(session: BrowserSession, contextId: string | undefined): BrowserContext {
    const context = contextId === undefined ? undefined : session.contexts.get(contextId);
    if (context === undefined) throw new Error('Browser context is unavailable');
    return context;
  }

  private requirePage(session: BrowserSession, pageId: string | undefined): Page {
    const page = pageId === undefined ? undefined : session.pages.get(pageId);
    if (page === undefined) throw new Error('Browser page is unavailable');
    return page;
  }

  private result(
    session: BrowserSession,
    page: Page | undefined,
    structured: Readonly<Record<string, unknown>>,
    artifactPath?: string,
    artifactHash?: string,
    accessibilityViolations = 0,
  ): BrowserDriverResult {
    const viewport = page?.viewportSize() ?? undefined;
    const url = page?.url();
    return {
      ...(url === undefined || url.length === 0 || url === 'about:blank'
        ? {}
        : { origin: new URL(url).origin }),
      ...(viewport === undefined ? {} : { viewport }),
      ...(artifactPath === undefined ? {} : { artifactPath }),
      ...(artifactHash === undefined ? {} : { artifactHash }),
      consoleFailures: session.consoleFailures.slice(-100),
      networkFailures: session.networkFailures.slice(-100),
      accessibilityViolations,
      structured,
    };
  }
}
