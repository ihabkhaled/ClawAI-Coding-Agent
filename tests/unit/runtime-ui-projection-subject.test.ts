import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: (number | string)[]) =>
      values.reduce<string>(
        (result, value, index) => result.replace(`{${String(index)}}`, String(value)),
        message,
      ),
  },
}));

import { RuntimeUiProjector } from '../../src/services/runtime-ui-projection';

import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';
import type { OutputLogger } from '../../src/infrastructure/output-logger';
import type { ChatViewProvider } from '../../src/webview/chat-view-provider';

const REQUEST_ID = '1c2f7f0e-6a2b-4d1e-9f0a-2b8c4d6e8f01';

const journal: RuntimeEvent[] = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../fixtures/journals/runtime-completed-run.journal.json', import.meta.url),
    ),
    'utf8',
  ),
) as RuntimeEvent[];

function event(type: string, payload: Record<string, unknown>): RuntimeEvent {
  const [first] = journal;
  if (first === undefined) throw new Error('the captured journal fixture is empty');
  return { ...first, type, payload };
}

function harness(): {
  projector: RuntimeUiProjector;
  view: { postEvent: ReturnType<typeof vi.fn> };
} {
  const view = {
    postEvent: vi.fn().mockResolvedValue(undefined),
    postResult: vi.fn().mockResolvedValue(undefined),
    postError: vi.fn().mockResolvedValue(undefined),
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const projector = new RuntimeUiProjector(
    () => view as unknown as ChatViewProvider,
    logger as unknown as OutputLogger,
    REQUEST_ID,
  );
  return { projector, view };
}

function requested(invocation: Record<string, unknown>): RuntimeEvent {
  return event('tool.requested', {
    invocation,
    invocationId: 'invocation-0001',
    operation: String(invocation.operation ?? ''),
    toolName: String(invocation.toolName ?? ''),
  });
}

/**
 * What the tool trail tells a user while the agent works.
 *
 * Before this, every line read "workspace.files · read" whatever the agent was
 * reading. That is indistinguishable from twenty identical calls, and gives a
 * person watching no way to tell progress from a loop.
 */
describe('the tool trail names what each call is about', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the file being read, not just the tool', () => {
    const { projector, view } = harness();

    projector.project(
      requested({
        toolName: 'workspace.files',
        operation: 'read',
        arguments: { path: 'src/app.ts' },
      }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      { type: 'RUNTIME_PHASE', label: 'workspace.files · read', description: 'src/app.ts' },
      REQUEST_ID,
    );
  });

  it('names the command being run', () => {
    const { projector, view } = harness();

    projector.project(
      requested({
        toolName: 'workspace.command',
        operation: 'execute',
        arguments: { command: 'npm test' },
      }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'npm test' }),
      REQUEST_ID,
    );
  });

  it('says how many further files a transaction touches', () => {
    const { projector, view } = harness();

    projector.project(
      requested({
        toolName: 'workspace.files',
        operation: 'transaction',
        arguments: {
          operations: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }],
        },
      }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'src/a.ts and 2 more' }),
      REQUEST_ID,
    );
  });

  it('falls back to Requested when the arguments name nothing', () => {
    // Honest rather than invented. A fabricated subject would read as a fact.
    const { projector, view } = harness();

    projector.project(
      requested({ toolName: 'runtime.journal', operation: 'list', arguments: { limit: 20 } }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Requested' }),
      REQUEST_ID,
    );
  });

  it('still reports the call when no invocation was carried at all', () => {
    // Older events, and any produced by a path that does not attach the
    // invocation, must not blank the trail.
    const { projector, view } = harness();

    projector.project(
      event('tool.requested', {
        invocationId: 'invocation-0001',
        operation: 'read',
        toolName: 'workspace.files',
      }),
    );

    expect(view.postEvent).toHaveBeenCalledWith(
      { type: 'RUNTIME_PHASE', label: 'workspace.files · read', description: 'Requested' },
      REQUEST_ID,
    );
  });
});
