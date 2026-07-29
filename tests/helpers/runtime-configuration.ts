import type { RuntimeConfiguration } from '../../src/services/configuration-service';

export function testRuntimeConfiguration(): RuntimeConfiguration {
  return {
    agentMode: 'AUTO',
    backendUrl: 'https://claw.local',
    exclude: [],
    historyLimit: 50,
    maxContextBytes: 200_000,
    maxContextFiles: 40,
    permissionMode: 'MANUAL',
    requestTimeoutMs: 60_000,
    routingMode: 'AUTO',
    selectedModel: '',
  };
}
