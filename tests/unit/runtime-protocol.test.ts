import { describe, expect, it } from 'vitest';

import {
  parseRuntimeEvent,
  parseRuntimeProtocolDescriptor,
} from '../../src/core/runtime/runtime-protocol.schemas';

const protocolDescriptor = {
  versions: ['2.0', '1.0'],
  preferred: '2.0',
  transports: ['sse'],
  features: {
    capabilityManifest: true,
    orderedRunEvents: true,
    toolExecution: false,
  },
  limits: {
    maxEventBytes: 262_144,
    maxActiveRuns: 8,
  },
};

const runtimeEvent = {
  schemaVersion: '2.0',
  eventId: 'evt_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  runId: 'run_01JZZZZZZZZZZZZZZZZZZZZZZZ',
  sequence: 0,
  timestamp: '2026-08-02T03:00:00.000Z',
  type: 'run.created',
  visibility: 'user',
  sensitivity: 'public',
  epochs: {
    account: 1,
    workspace: 2,
    target: 3,
    policy: 4,
  },
  payload: {},
};

describe('runtime protocol schemas', () => {
  it('round-trips the supported protocol descriptor', () => {
    expect(parseRuntimeProtocolDescriptor(protocolDescriptor)).toEqual(protocolDescriptor);
  });

  it('rejects unknown protocol descriptor fields', () => {
    expect(() =>
      parseRuntimeProtocolDescriptor({ ...protocolDescriptor, administratorShell: true }),
    ).toThrow();
  });

  it('rejects a preferred protocol version that is not supported', () => {
    expect(() =>
      parseRuntimeProtocolDescriptor({
        ...protocolDescriptor,
        versions: ['1.0'],
        preferred: '2.0',
      }),
    ).toThrow(/preferred/i);
  });

  it('rejects duplicate supported protocol versions', () => {
    expect(() =>
      parseRuntimeProtocolDescriptor({
        ...protocolDescriptor,
        versions: ['2.0', '2.0'],
      }),
    ).toThrow(/unique/i);
  });

  it('round-trips a canonical runtime event', () => {
    expect(parseRuntimeEvent(runtimeEvent)).toEqual(runtimeEvent);
  });

  it('rejects unknown runtime event envelope fields', () => {
    expect(() => parseRuntimeEvent({ ...runtimeEvent, rawReasoning: 'private chain' })).toThrow();
  });

  it('rejects malformed timestamps, hashes, IDs, versions, and negative epochs', () => {
    const invalidValues = [
      { timestamp: 'yesterday' },
      { contentHash: 'md5:1234' },
      { eventId: '' },
      { schemaVersion: '3.0' },
      { epochs: { ...runtimeEvent.epochs, workspace: -1 } },
    ];

    for (const invalid of invalidValues) {
      expect(() => parseRuntimeEvent({ ...runtimeEvent, ...invalid })).toThrow();
    }
  });

  it('accepts a syntactically valid future event name as inert protocol data', () => {
    const parsed = parseRuntimeEvent({ ...runtimeEvent, type: 'artifact.sbom.attested' });

    expect(parsed.type).toBe('artifact.sbom.attested');
  });
});
