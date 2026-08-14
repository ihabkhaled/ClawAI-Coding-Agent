import { describe, expect, it } from 'vitest';

import { readRuntimeStreamEvent } from '../../src/core/runtime/runtime-event-stream';
import {
  RuntimeStreamTransportError,
  isResumableStreamFailure,
  streamResumeDelayMs,
  waitBeforeStreamResume,
} from '../../src/core/runtime/runtime-stream-resume';
import { RUNTIME_STREAM_TRANSPORT_ATTEMPTS } from '../../src/core/runtime/runtime-stream-resume.constants';

import type { RuntimeDispatchState } from '../../src/core/runtime/runtime-event-stream.types';

const dispatchState = (failure?: Error): RuntimeDispatchState => ({
  failureController: new AbortController(),
  pendingDispatches: new Set<Promise<void>>(),
  ...(failure === undefined ? {} : { failure }),
});

describe('isResumableStreamFailure', () => {
  const transport = new RuntimeStreamTransportError(new Error('Connection is closed'));

  it('resumes an early transport failure', () => {
    expect(
      isResumableStreamFailure(transport, 1, new AbortController().signal, dispatchState()),
    ).toBe(true);
  });

  it('never resumes a failure the backend actually reported', () => {
    // An unreadable frame replays from the same cursor, so retrying loops six
    // times and then reports the original error late instead of at once.
    expect(
      isResumableStreamFailure(
        new Error('Runtime event frame is unreadable'),
        1,
        new AbortController().signal,
        dispatchState(),
      ),
    ).toBe(false);
  });

  it('stops once the attempts are spent', () => {
    const signal = new AbortController().signal;
    expect(
      isResumableStreamFailure(
        transport,
        RUNTIME_STREAM_TRANSPORT_ATTEMPTS,
        signal,
        dispatchState(),
      ),
    ).toBe(true);
    expect(
      isResumableStreamFailure(
        transport,
        RUNTIME_STREAM_TRANSPORT_ATTEMPTS + 1,
        signal,
        dispatchState(),
      ),
    ).toBe(false);
  });

  it('never resumes a cancelled run', () => {
    // Reopening here would restart a run the user has stopped.
    const controller = new AbortController();
    controller.abort();
    expect(isResumableStreamFailure(transport, 1, controller.signal, dispatchState())).toBe(false);
  });

  it('never resumes past a recorded dispatch failure', () => {
    // A tool that failed is the run's answer, not a connection problem;
    // retrying the stream would bury it behind a reconnect.
    const state = dispatchState(new Error('tool exploded'));
    expect(isResumableStreamFailure(transport, 1, new AbortController().signal, state)).toBe(false);
  });
});

describe('streamResumeDelayMs', () => {
  it('backs off further on each attempt', () => {
    expect(streamResumeDelayMs(1)).toBeLessThan(streamResumeDelayMs(2));
    expect(streamResumeDelayMs(2)).toBeLessThan(streamResumeDelayMs(3));
  });

  it('holds the last delay beyond the table', () => {
    expect(streamResumeDelayMs(99)).toBe(streamResumeDelayMs(RUNTIME_STREAM_TRANSPORT_ATTEMPTS));
  });

  it('clamps a nonsensical attempt to the first delay', () => {
    expect(streamResumeDelayMs(0)).toBe(streamResumeDelayMs(1));
  });
});

describe('waitBeforeStreamResume', () => {
  it('returns immediately when the run is cancelled mid-backoff', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const waited = waitBeforeStreamResume(5_000, controller.signal);
    controller.abort();
    await waited;
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('waits out the delay when nothing interrupts it', async () => {
    const started = Date.now();
    await waitBeforeStreamResume(30, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('transient backend state frames', () => {
  it('is tagged as transport so the stream reopens instead of failing', () => {
    // The backend sends this over an HTTP 200 stream while it restarts. Read
    // as an ordinary error it killed the run; the run itself is untouched in
    // Redis, so the only thing that actually failed was the connection.
    let thrown: unknown;
    try {
      readRuntimeStreamEvent({ code: 'RUNTIME_STATE_UNAVAILABLE', message: 'Runtime state' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RuntimeStreamTransportError);
  });

  it('leaves every other backend code alone', () => {
    let thrown: unknown;
    try {
      readRuntimeStreamEvent({ code: 'RUNTIME_TRANSITION_DENIED', message: 'Denied' });
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(RuntimeStreamTransportError);
    expect((thrown as Error).message).toContain('RUNTIME_TRANSITION_DENIED');
  });
});
