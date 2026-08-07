import type { RuntimeConfiguration } from '../../src/services/configuration-service';

export function testRuntimeConfiguration(): RuntimeConfiguration {
  return {
    agentMode: 'AUTO',
    effortMode: 'ULTRA',
    backendCustomUrl: '',
    backendEnvironment: 'LOCAL',
    backendUrl: 'https://claw.local',
    exclude: [],
    historyLimit: 50,
    frontendCustomUrl: '',
    frontendEnvironment: 'LOCAL',
    frontendUrl: 'https://claw.local',
    maxContextBytes: 200_000,
    maxContextFiles: 40,
    permissionMode: 'MANUAL',
    requestTimeoutMs: 60_000,
    routingMode: 'AUTO',
    selectedModel: '',
  };
}
