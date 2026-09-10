import { describe, expect, it, vi } from 'vitest';

import {
  decideAutoCompaction,
  normalizeAutoCompactionMode,
  trackRaisedConversations,
} from '../../src/core/compaction-trigger';
import { selectedModelCapacity } from '../../src/core/model-catalog';
import { AutoCompactionService } from '../../src/services/auto-compaction-service';

import type { AutoCompactionMode } from '../../src/core/compaction-trigger.types';
import type { ModelCatalogEntry } from '../../src/core/model-catalog';

function entry(contextTokens: number | null): ModelCatalogEntry {
  return {
    id: 'id',
    key: 'PROVIDER:model',
    provider: 'PROVIDER',
    model: 'model',
    displayName: 'Model',
    isLocal: false,
    source: 'connector',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: false,
    contextTokens,
  };
}

describe('decideAutoCompaction', () => {
  const full = {
    mode: 'prompt' as AutoCompactionMode,
    nearlyFull: true,
    runInFlight: false,
    alreadyRaised: false,
  };

  it('offers when the conversation is nearly full', () => {
    expect(decideAutoCompaction(full)).toBe('offer');
  });

  it('compacts without asking only in the automatic mode', () => {
    expect(decideAutoCompaction({ ...full, mode: 'automatic' })).toBe('compact');
  });

  it('lets off beat every other reason to act', () => {
    expect(decideAutoCompaction({ ...full, mode: 'off' })).toBe('none');
  });

  it('does nothing while a run is still writing into the conversation', () => {
    expect(decideAutoCompaction({ ...full, runInFlight: true })).toBe('none');
  });

  it('does not raise the same conversation twice', () => {
    expect(decideAutoCompaction({ ...full, alreadyRaised: true })).toBe('none');
  });

  it('does nothing while there is still room', () => {
    expect(decideAutoCompaction({ ...full, nearlyFull: false })).toBe('none');
  });
});

describe('trackRaisedConversations', () => {
  it('remembers a conversation that is nearly full', () => {
    expect([...trackRaisedConversations(new Set(), 'a', true)]).toEqual(['a']);
  });

  it('forgets it once usage falls back, so a later fill can ask again', () => {
    expect([...trackRaisedConversations(new Set(['a']), 'a', false)]).toEqual([]);
  });

  it('tracks conversations separately, because one filling says nothing about another', () => {
    const raised = trackRaisedConversations(new Set(['a']), 'b', true);

    expect([...raised].sort()).toEqual(['a', 'b']);
  });
});

describe('normalizeAutoCompactionMode', () => {
  it('keeps a value it recognises', () => {
    expect(normalizeAutoCompactionMode('automatic')).toBe('automatic');
    expect(normalizeAutoCompactionMode('off')).toBe('off');
  });

  it('falls back to the mode that cannot surprise anybody', () => {
    expect(normalizeAutoCompactionMode('yes please')).toBe('prompt');
    expect(normalizeAutoCompactionMode(undefined)).toBe('prompt');
  });
});

describe('selectedModelCapacity', () => {
  it('has no answer under a router-selected mode, which chooses per request', () => {
    expect(selectedModelCapacity('COST_SAVER', 'PROVIDER:model', [entry(100_000)])).toBeNull();
  });

  it('reports the window of the manually chosen model', () => {
    expect(selectedModelCapacity('MANUAL_MODEL', 'PROVIDER:model', [entry(100_000)])).toBe(100_000);
  });

  it('reports nothing rather than a guess when the model declares no window', () => {
    expect(selectedModelCapacity('MANUAL_MODEL', 'PROVIDER:model', [entry(null)])).toBeNull();
    expect(selectedModelCapacity('MANUAL_MODEL', 'gone', [entry(100_000)])).toBeNull();
  });
});

describe('AutoCompactionService', () => {
  // `capacity` is a positional default rather than a `??` fallback: null is a
  // meaningful value here, and `??` would quietly replace it.
  function harness(mode: AutoCompactionMode = 'prompt', capacity: number | null = 10_000) {
    const compact = vi.fn(async () => undefined);
    const compactSilently = vi.fn(async () => undefined);
    let busy = false;
    const service = new AutoCompactionService({
      mode: () => mode,
      capacity: () => capacity,
      busy: () => busy,
      compact,
      compactSilently,
    });
    return { compact, compactSilently, service, setBusy: (value: boolean) => (busy = value) };
  }

  it('offers once as a conversation fills, and not again while it stays full', async () => {
    const seat = harness();

    expect(await seat.service.observe('thread-1', 9_000)).toBe('offer');
    expect(await seat.service.observe('thread-1', 9_200)).toBe('none');
    expect(seat.compact).toHaveBeenCalledTimes(1);
  });

  it('asks again after the conversation has moved on', async () => {
    const seat = harness();
    await seat.service.observe('thread-1', 9_000);
    await seat.service.observe('thread-1', 100);

    expect(await seat.service.observe('thread-1', 9_000)).toBe('offer');
  });

  it('stays quiet while a run is still writing', async () => {
    const seat = harness();
    seat.setBusy(true);

    expect(await seat.service.observe('thread-1', 9_500)).toBe('none');
    expect(seat.compact).not.toHaveBeenCalled();
  });

  it('never acts when the capacity is unknown, because the trigger would be a guess', async () => {
    const seat = harness('prompt', null);

    expect(await seat.service.observe('thread-1', 9_999_999)).toBe('none');
  });

  it('compacts without asking in the automatic mode', async () => {
    const seat = harness('automatic');

    expect(await seat.service.observe('thread-1', 9_000)).toBe('compact');
    expect(seat.compactSilently).toHaveBeenCalledTimes(1);
    expect(seat.compact).not.toHaveBeenCalled();
  });
});
