import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { agentConfigFor } from '../../src/headless/headless-agent-config';
import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { HEADLESS_USAGE } from '../../src/headless/headless-args.constants';

const cwd = path.resolve('/work');

function invocationFor(...extra: string[]) {
  const parsed = parseHeadlessArgs(['-p', 'task', ...extra], {}, cwd);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

function configFor(...extra: string[]) {
  return agentConfigFor({
    invocation: invocationFor(...extra),
    inputs: { ok: true as const },
    auth: { token: 't' },
    threadId: undefined,
    environment: {},
    io: { stdout: () => undefined, stderr: () => undefined },
    transport: undefined,
  });
}

describe('--load-knowledge', () => {
  it('is off unless asked for', () => {
    expect(invocationFor().loadKnowledge).toBeUndefined();
    expect(configFor().loadKnowledge).toBeUndefined();
  });

  it('reaches the agent configuration and changes no permission', () => {
    const plain = configFor('--allow-tools', 'read');
    const loaded = configFor('--load-knowledge', '--allow-tools', 'read');

    expect(loaded.loadKnowledge).toBe(true);
    expect(loaded.permissions).toEqual(plain.permissions);
  });

  it('is documented in the usage text', () => {
    expect(HEADLESS_USAGE).toContain('--load-knowledge');
  });
});
