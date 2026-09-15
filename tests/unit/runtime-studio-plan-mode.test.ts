import { describe, expect, it } from 'vitest';

import { studioHarness } from '../helpers/runtime-studio-harness';

describe('runtime studio plan mode', () => {
  it('tells the model the run is read-only instead of letting it discover that by refusal', async () => {
    const { capture, run } = studioHarness('HIGH', 'PLAN');
    await run();

    expect(capture.starts[0]?.prompt).toContain('read-only');
    expect(capture.starts[0]?.prompt).toContain('implementation plan');
    expect(capture.starts[0]?.prompt).toContain('add a test');
  });

  it('sends an Auto prompt exactly as the user wrote it', async () => {
    const { capture, run } = studioHarness('HIGH', 'AUTO');
    await run();

    expect(capture.starts[0]?.prompt).toBe('add a test');
  });

  it('journals the raw request and the mode separately, so a resume can re-apply it once', async () => {
    const { capture, run } = studioHarness('HIGH', 'PLAN');
    await run();

    expect(capture.journals[0]).toMatchObject({ goal: 'add a test', agentMode: 'PLAN' });
  });
});
