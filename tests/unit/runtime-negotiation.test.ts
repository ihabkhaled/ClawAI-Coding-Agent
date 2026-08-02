import { describe, expect, it } from 'vitest';

import { selectRuntimeProtocol } from '../../src/core/runtime/runtime-negotiation';

const descriptor = {
  versions: ['2.0', '1.0'],
  preferred: '2.0',
  transports: ['sse'],
  features: {
    capabilityManifest: true,
    orderedRunEvents: true,
    toolExecution: false,
  },
  limits: { maxEventBytes: 1_048_576, maxActiveRuns: 8 },
};

describe('runtime protocol negotiation', () => {
  it('selects the inert V2 foundation without requiring tool execution', () => {
    expect(selectRuntimeProtocol(descriptor)).toMatchObject({ mode: 'runtime-v2', version: '2.0' });
  });

  it('selects V2 when a future server version is preferred but V2 overlaps', () => {
    expect(
      selectRuntimeProtocol({
        ...descriptor,
        versions: ['3.0', '2.0', '1.0'],
        preferred: '3.0',
      }),
    ).toMatchObject({ mode: 'runtime-v2', version: '2.0' });
  });

  it.each([
    [{ ...descriptor, versions: ['1.0'], preferred: '1.0' }, 'unsupported-version'],
    [{ ...descriptor, transports: ['websocket'] }, 'unsupported-transport'],
    [
      { ...descriptor, features: { ...descriptor.features, orderedRunEvents: false } },
      'missing-foundation-feature',
    ],
  ] as const)('falls back to legacy mode for an incompatible descriptor', (server, reason) => {
    expect(selectRuntimeProtocol(server)).toEqual({ mode: 'legacy-v1', version: '1.0', reason });
  });
});
