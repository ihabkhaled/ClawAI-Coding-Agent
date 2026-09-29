import { describe, expect, it } from 'vitest';

import {
  buildCloudSessionCommand,
  isCloudTaskFinished,
} from '../../src/core/cloud-session-command';
import { isRunActiveElsewhere } from '../../src/core/resume-readiness';
import { ACTIVE_ELSEWHERE_WINDOW_MS } from '../../src/core/resume-readiness.constants';
import { threadOriginForSource, threadSurfaceOf } from '../../src/core/thread-source';

describe('thread source', () => {
  it('writes one origin for both agent surfaces so their history is shared', () => {
    expect(threadOriginForSource('vscode')).toBe('CODING_AGENT');
    expect(threadOriginForSource('cli')).toBe('CODING_AGENT');
    expect(threadOriginForSource('web')).toBe('WEB');
  });

  it('reads an absent origin as web, the backend default', () => {
    expect(threadSurfaceOf('CODING_AGENT')).toBe('agent');
    expect(threadSurfaceOf('WEB')).toBe('web');
    expect(threadSurfaceOf(undefined)).toBe('web');
  });
});

describe('isRunActiveElsewhere', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  const recent = new Date(now - 60_000).toISOString();
  const stale = new Date(now - ACTIVE_ELSEWHERE_WINDOW_MS - 1).toISOString();

  it('is false for an empty thread and for one whose newest message is a reply', () => {
    expect(isRunActiveElsewhere([], now)).toBe(false);
    expect(
      isRunActiveElsewhere(
        [
          { role: 'ASSISTANT', createdAt: recent },
          { role: 'USER', createdAt: stale },
        ],
        now,
      ),
    ).toBe(false);
  });

  it('is true for a recent unanswered prompt, whatever the list order', () => {
    expect(
      isRunActiveElsewhere(
        [
          { role: 'ASSISTANT', createdAt: stale },
          { role: 'user', createdAt: recent },
        ],
        now,
      ),
    ).toBe(true);
  });

  it('treats an old unanswered prompt as a failed run, not a live one', () => {
    expect(isRunActiveElsewhere([{ role: 'USER', createdAt: stale }], now)).toBe(false);
  });

  it('assumes live when the prompt carries no readable time', () => {
    expect(isRunActiveElsewhere([{ role: 'USER' }], now)).toBe(true);
    expect(isRunActiveElsewhere([{ role: 'USER', createdAt: 'not a date' }], now)).toBe(true);
  });
});

describe('buildCloudSessionCommand', () => {
  it('checks out the branch before the task', () => {
    expect(buildCloudSessionCommand({ branch: 'feature/login-fix', task: ' npm test ' })).toEqual({
      ok: true,
      command: 'git checkout feature/login-fix && npm test',
    });
  });

  it.each(['-evil', 'a;rm -rf /', 'a b', 'a..b', 'a//b', 'trailing/', '$(id)', ''])(
    'refuses the branch %j rather than escaping it',
    (branch) => {
      expect(buildCloudSessionCommand({ branch, task: 'npm test' })).toEqual({
        ok: false,
        reason: 'unsafe-branch',
      });
    },
  );

  it('refuses an empty task and one past the runner limit', () => {
    expect(buildCloudSessionCommand({ branch: 'main', task: '   ' })).toEqual({
      ok: false,
      reason: 'empty-task',
    });
    expect(buildCloudSessionCommand({ branch: 'main', task: 'x'.repeat(4_096) })).toEqual({
      ok: false,
      reason: 'too-long',
    });
  });

  it('knows which runner statuses are final', () => {
    expect(isCloudTaskFinished('EXECUTED')).toBe(true);
    expect(isCloudTaskFinished('REJECTED')).toBe(true);
    expect(isCloudTaskFinished('PENDING_APPROVAL')).toBe(false);
    expect(isCloudTaskFinished('EXECUTING')).toBe(false);
  });
});
