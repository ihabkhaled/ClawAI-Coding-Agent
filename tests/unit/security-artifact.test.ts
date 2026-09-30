import { describe, expect, it, vi } from 'vitest';

import { prepareArtifact } from '../../src/core/artifact-publication';
import { redactText } from '../../src/core/redaction';
import { ArtifactToolExecutor } from '../../src/infrastructure/artifact-tool-executor';

import type { ToolInvocation } from '../../src/core/runtime/runtime-tool-contracts';

function invocation(args: Record<string, unknown>): ToolInvocation {
  return {
    schemaVersion: '2.0',
    invocationId: 'invocation:artifact',
    runId: 'runtime:artifact',
    turnId: 'turn:artifact',
    toolName: 'workspace.artifact',
    toolVersion: '1.0.0',
    operation: 'publish',
    arguments: args,
    targetId: 'target:workspace',
    epochs: { account: 1, workspace: 1, target: 1, policy: 1 },
    idempotencyKey: 'idempotency:artifact',
    requestedAt: '2026-09-29T00:00:00.000Z',
  } as ToolInvocation;
}

describe('artifact publication only reads inside the workspace', () => {
  const escapes = [
    '../../.ssh/id_rsa',
    '/etc/passwd',
    String.raw`C:\Users\me\.npmrc`,
    String.raw`..\..\x`,
    'a/../../b',
  ];
  it.each(escapes)('refuses %s before any read', async (path) => {
    const read = vi.fn(async () => 'secret');
    const publish = vi.fn();
    const subject = new ArtifactToolExecutor({ read }, { publish });
    await expect(subject.execute(invocation({ rootKey: 'workspace', path }))).rejects.toThrow(
      /inside the workspace/u,
    );
    expect(read).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('still reads an ordinary relative path', async () => {
    const read = vi.fn(async () => '# ok');
    const publish = vi.fn(async () => ({
      status: 'published' as const,
      id: 'a1',
      url: 'https://x.test/a',
    }));
    const subject = new ArtifactToolExecutor({ read }, { publish });
    await subject.execute(invocation({ rootKey: 'workspace', path: 'docs/a.md' }));
    expect(read).toHaveBeenCalledWith('workspace', 'docs/a.md');
  });
});

describe('artifact secret scrub covers common credential shapes', () => {
  const blocked: Record<string, string> = {
    'encrypted key': '-----BEGIN ENCRYPTED PRIVATE KEY-----',
    'pgp key': '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    'github fine-grained': `github_pat_${'A1b2C3d4E5'.repeat(3)}`,
    'npm token': `npm_${'aB3dE5gH7j'.repeat(4)}`,
    'gitlab token': ['glpat', 'aB3dE5gH7jK9mN1pQ3rS'].join('-'),
    'sendgrid key': ['SG', 'aB3dE5gH7jK9mN1pQ3rS', 'aB3dE5gH7jK9mN1pQ3rS'].join('.'),
    'stripe webhook': ['whsec', 'aB3dE5gH7jK9mN1pQ3rS4tU'].join('_'),
    'slack app token': ['xapp', '1', 'A0123456789', '1234567890', 'abcdef0123456789'].join('-'),
    'google oauth': ['ya29', 'aB3dE5gH7jK9mN1pQ3rS4tU6vW8'].join('.'),
  };
  it.each(Object.entries(blocked))('never publishes %s', (_name, secret) => {
    const result = prepareArtifact({ path: 'page.md', content: `value ${secret} end` });
    expect(result.status === 'ready' ? result.content : 'blocked').not.toContain(secret);
    expect(result.status === 'ready' && result.content.includes(secret)).toBe(false);
  });

  it('masks or blocks credentials embedded in a connection URL', () => {
    const result = prepareArtifact({
      path: 'notes.txt',
      content: 'DATABASE_URL=postgres://admin:hunter2hunter2@db.internal:5432/app',
    });
    expect(result.status === 'ready' ? result.content : '').not.toContain('hunter2hunter2');
  });
});

describe('redaction covers non-bearer credentials', () => {
  it('masks Basic authorization', () => {
    expect(redactText('Authorization: Basic dXNlcjpwYXNzd29yZA==')).not.toContain(
      'dXNlcjpwYXNzd29yZA==',
    );
  });
  it('masks userinfo in URLs', () => {
    const out = redactText('cloning https://user:s3cr3tpass@github.com/x/y.git now');
    expect(out).not.toContain('s3cr3tpass');
    expect(out).toContain('github.com/x/y.git');
  });
  it('leaves URLs without userinfo alone', () => {
    expect(redactText('see https://github.com/x/y.git')).toBe('see https://github.com/x/y.git');
  });
});
