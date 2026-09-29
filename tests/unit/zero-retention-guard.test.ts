import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string) => message,
  },
}));

import { agentOperationErrorMessage } from '../../src/backend/backend-error-message';
import { BackendRequestError } from '../../src/backend/backend-errors';
import {
  retentionRequestHeaders,
  ZeroRetentionRefusedError,
} from '../../src/backend/zero-retention-guard';
import { zeroRetentionRefusalMessage } from '../../src/backend/zero-retention-messages';
import { ZERO_RETENTION_HEADER, ZERO_RETENTION_OFF } from '../../src/core/zero-retention.constants';

const ON = { active: true, source: 'setting' } as const;

function refusal(path: string): BackendRequestError {
  try {
    retentionRequestHeaders('POST', path, ON);
  } catch (error) {
    if (error instanceof BackendRequestError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('retentionRequestHeaders', () => {
  it('adds nothing and refuses nothing while retention is normal', () => {
    expect(retentionRequestHeaders('POST', '/files/upload', ZERO_RETENTION_OFF)).toEqual({});
  });

  it('flags every request under zero retention', () => {
    expect(retentionRequestHeaders('POST', '/chat-messages', ON)).toEqual({
      [ZERO_RETENTION_HEADER]: '1',
    });
    expect(retentionRequestHeaders('GET', '/chat-messages/stream/t?replay=false', ON)).toEqual({
      [ZERO_RETENTION_HEADER]: '1',
    });
  });

  it.each([
    ['/files/upload', 'files are not uploaded'],
    ['/artifacts', 'nothing is published'],
    ['/chat-threads/t-1/share', 'cannot be shared'],
  ])('refuses %s before it is sent, with the reason', (path, reason) => {
    const error = refusal(path);
    expect(error.status).toBe(403);
    expect(error.retryable).toBe(false);
    expect(error.message).toContain(reason);
  });

  it('is a typed refusal the operation-error surface translates', () => {
    const error = refusal('/files/upload');
    expect(error).toBeInstanceOf(ZeroRetentionRefusedError);
    expect(agentOperationErrorMessage(error)).toBe(zeroRetentionRefusalMessage('upload'));
    expect(zeroRetentionRefusalMessage('artifact-publish')).toContain('nothing is published');
    expect(zeroRetentionRefusalMessage('share')).toContain('cannot be shared');
  });

  it('reads the process-wide posture by default', () => {
    expect(retentionRequestHeaders('POST', '/files/upload')).toEqual({});
  });
});
