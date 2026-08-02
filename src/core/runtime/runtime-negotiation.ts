export interface RuntimeProtocolWireDescriptor {
  readonly features: {
    readonly capabilityManifest: boolean;
    readonly orderedRunEvents: boolean;
    readonly toolExecution: boolean;
  };
  readonly limits: {
    readonly maxActiveRuns: number;
    readonly maxEventBytes: number;
  };
  readonly preferred: string;
  readonly transports: readonly string[];
  readonly versions: readonly string[];
}

export type RuntimeFallbackReason =
  | 'unsupported-version'
  | 'unsupported-transport'
  | 'missing-foundation-feature'
  | 'tool-execution-unavailable'
  | 'endpoint-unavailable'
  | 'malformed-descriptor';

export type RuntimeProtocolSelection =
  | {
      readonly descriptor: RuntimeProtocolWireDescriptor;
      readonly mode: 'runtime-v2';
      readonly version: '2.0';
    }
  | {
      readonly mode: 'legacy-v1';
      readonly reason: RuntimeFallbackReason;
      readonly version: '1.0';
    };

function fallback(reason: RuntimeFallbackReason): RuntimeProtocolSelection {
  return { mode: 'legacy-v1', reason, version: '1.0' };
}

export function selectRuntimeProtocol(
  descriptor: RuntimeProtocolWireDescriptor,
): RuntimeProtocolSelection {
  if (!descriptor.versions.includes('2.0')) {
    return fallback('unsupported-version');
  }
  if (!descriptor.transports.includes('sse')) {
    return fallback('unsupported-transport');
  }
  if (!descriptor.features.capabilityManifest || !descriptor.features.orderedRunEvents) {
    return fallback('missing-foundation-feature');
  }
  if (!descriptor.features.toolExecution) {
    return fallback('tool-execution-unavailable');
  }
  return { descriptor, mode: 'runtime-v2', version: '2.0' };
}

export function runtimeProtocolFallback(reason: RuntimeFallbackReason): RuntimeProtocolSelection {
  return fallback(reason);
}
