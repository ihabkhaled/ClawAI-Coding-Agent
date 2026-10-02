import { describe, expect, it } from 'vitest';

import { toolResultFor } from '../../src/sdk/agent-tool-result';

import type { HeadlessStreamEvent } from '../../src/headless/headless-session.types';
import type { AgentToolkit } from '../../src/sdk/agent-sdk.types';

const event: HeadlessStreamEvent = {
  type: 'tool.requested',
  payload: {
    invocationId: 'i-1',
    toolName: 'workspace.file',
    operation: 'read',
    invocation: { arguments: { path: 'a' } },
  },
};

const failing = (message: string): AgentToolkit => ({
  definitions: [],
  execute: () => {
    throw new Error(message);
  },
});

describe('a failed tool result', () => {
  it.each([
    ['a trailing newline', 'could not read\n', 'could not read'],
    ['a message cut in the middle of a space', `${'x'.repeat(399)} tail`, 'x'.repeat(399)],
    ['leading and trailing blanks', '  oops  ', 'oops'],
  ])('carries a message without edge whitespace for %s', async (_name, message, expected) => {
    const result = (await toolResultFor(event, failing(message))) as {
      status: string;
      error: { message: string };
    };

    expect(result.status).toBe('failed');
    expect(result.error.message).toBe(expected);
  });
});
