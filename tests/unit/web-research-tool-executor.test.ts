import { describe, expect, it, vi } from 'vitest';

import { WebResearchToolExecutor } from '../../src/infrastructure/web-research-tool-executor';

import type { WebResearchPort } from '../../src/backend/research-client';
import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

const epochs = { account: 1, workspace: 1, target: 1, policy: 1 };

function invocation(operation: string, args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:web',
    runId: 'runtime:web',
    turnId: 'turn:web',
    toolName: 'workspace.web',
    toolVersion: '2.0.0',
    operation,
    arguments: args,
    targetId: 'target:workspace',
    epochs,
    idempotencyKey: 'idempotency:web',
    requestedAt: '2026-09-09T12:00:00.000Z',
  } as ToolInvocation;
}

function research(overrides: Partial<WebResearchPort> = {}): WebResearchPort {
  return {
    search: vi.fn(async () => ({
      runId: 'run-1',
      providerId: 'brave',
      query: 'zod',
      results: [{ id: 'r1', title: 'Zod', url: 'https://zod.dev', snippet: 'Schemas' }],
    })),
    fetch: vi.fn(async () => ({
      url: 'https://zod.dev',
      finalUrl: 'https://zod.dev/',
      httpStatus: 200,
      title: 'Zod',
      content: 'Schema validation',
    })),
    ...overrides,
  };
}

describe('WebResearchToolExecutor', () => {
  it('returns ranked results with their sources', async () => {
    const output = await new WebResearchToolExecutor(research()).execute(
      invocation('search', { query: 'zod' }),
    );

    expect(output.structured).toMatchObject({
      query: 'zod',
      results: [{ title: 'Zod', url: 'https://zod.dev', snippet: 'Schemas' }],
    });
  });

  it('marks everything it returns as untrusted, because someone else wrote it', async () => {
    const subject = new WebResearchToolExecutor(research());

    await expect(subject.execute(invocation('search', { query: 'zod' }))).resolves.toMatchObject({
      structured: { untrusted: true },
    });
    await expect(
      subject.execute(invocation('fetch', { url: 'https://zod.dev' })),
    ).resolves.toMatchObject({ structured: { untrusted: true } });
  });

  it('returns the cleaned page and where it actually ended up', async () => {
    const output = await new WebResearchToolExecutor(research()).execute(
      invocation('fetch', { url: 'https://zod.dev' }),
    );

    expect(output.structured).toMatchObject({
      finalUrl: 'https://zod.dev/',
      httpStatus: 200,
      content: 'Schema validation',
    });
  });

  it('refuses a private address before it ever reaches the server', async () => {
    const port = research();

    await expect(
      new WebResearchToolExecutor(port).execute(
        invocation('fetch', { url: 'http://169.254.169.254/latest/meta-data/' }),
      ),
    ).rejects.toThrow(/private address/u);
    expect(port.fetch).not.toHaveBeenCalled();
  });

  it('refuses a scheme that is not the web', async () => {
    await expect(
      new WebResearchToolExecutor(research()).execute(
        invocation('fetch', { url: 'file:///etc/passwd' }),
      ),
    ).rejects.toThrow(/http and https/u);
  });

  it('refuses an operation it does not advertise', async () => {
    await expect(
      new WebResearchToolExecutor(research()).execute(
        invocation('crawl', { url: 'https://a.dev' }),
      ),
    ).rejects.toThrow(/Unknown web operation/u);
  });

  it('refuses an invocation aimed at another tool', async () => {
    const wrong = { ...invocation('search', { query: 'a' }), toolName: 'workspace.files' };

    await expect(new WebResearchToolExecutor(research()).execute(wrong)).rejects.toThrow(
      /Unknown web tool/u,
    );
  });
});
