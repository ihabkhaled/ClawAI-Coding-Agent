import { describe, expect, it } from 'vitest';

import { GenerationThreadRegistry } from '../../src/core/generation-thread-registry';

describe('GenerationThreadRegistry', () => {
  it('takes only the requested thread and keeps other active runs isolated', () => {
    const registry = new GenerationThreadRegistry();
    registry.record('request-a', 'thread-a');
    registry.record('request-b', 'thread-b');

    expect(registry.take('request-a')).toBe('thread-a');
    expect(registry.takeAll()).toEqual(['thread-b']);
    expect(registry.takeAll()).toEqual([]);
  });

  it('forgets a settled request without returning another request thread', () => {
    const registry = new GenerationThreadRegistry();
    registry.record('request-a', 'thread-a');
    registry.record('request-b', 'thread-b');

    registry.forget('request-a');

    expect(registry.take('request-a')).toBeNull();
    expect(registry.take('request-b')).toBe('thread-b');
  });
});
