import { describe, expect, it } from 'vitest';

import {
  BACKEND_CLOUD_URL,
  BACKEND_LOCAL_URL,
  FRONTEND_CLOUD_URL,
  FRONTEND_LOCAL_URL,
  resolveConnectionEndpoint,
  normalizeFrontendUrl,
  mergeConfiguration,
  normalizeBackendUrl,
  normalizeRoutingMode,
  parseWorkspaceConfiguration,
} from '../../src/core/configuration';

describe('connection environments', () => {
  it('resolves the local, cloud, and custom endpoints', () => {
    expect(resolveConnectionEndpoint('backend', 'LOCAL', '')).toBe(BACKEND_LOCAL_URL);
    expect(resolveConnectionEndpoint('frontend', 'LOCAL', '')).toBe(FRONTEND_LOCAL_URL);
    expect(resolveConnectionEndpoint('backend', 'CLOUD', '')).toBe(BACKEND_CLOUD_URL);
    expect(resolveConnectionEndpoint('frontend', 'CLOUD', '')).toBe(FRONTEND_CLOUD_URL);
    expect(resolveConnectionEndpoint('backend', 'CUSTOM', 'https://api.example.com/')).toBe(
      'https://api.example.com',
    );
    expect(resolveConnectionEndpoint('frontend', 'CUSTOM', 'https://app.example.com/')).toBe(
      'https://app.example.com',
    );
  });

  it('ignores a stale custom URL when the cloud lane is selected', () => {
    expect(resolveConnectionEndpoint('backend', 'CLOUD', 'https://left-over.example.com')).toBe(
      BACKEND_CLOUD_URL,
    );
    expect(resolveConnectionEndpoint('frontend', 'CLOUD', 'https://left-over.example.com')).toBe(
      FRONTEND_CLOUD_URL,
    );
  });

  it('publishes cloud endpoints that survive the extension URL guards', () => {
    expect(normalizeBackendUrl(BACKEND_CLOUD_URL)).toBe(BACKEND_CLOUD_URL);
    expect(normalizeFrontendUrl(FRONTEND_CLOUD_URL)).toBe(FRONTEND_CLOUD_URL);
    expect(new URL(BACKEND_CLOUD_URL).protocol).toBe('https:');
    expect(new URL(FRONTEND_CLOUD_URL).protocol).toBe('https:');
  });

  it('normalizes safe frontend origins and rejects unsafe hosted URLs', () => {
    expect(normalizeFrontendUrl('https://claw.local/')).toBe('https://claw.local');
    expect(normalizeFrontendUrl('https://claw.example/app/')).toBe('https://claw.example/app');
    expect(() => normalizeFrontendUrl('http://claw.example')).toThrow();
  });
});

describe('backend URL normalization', () => {
  it('normalizes a local origin without losing a configured base path', () => {
    expect(normalizeBackendUrl('http://localhost:8080/claw/')).toBe('http://localhost:8080/claw');
    expect(normalizeBackendUrl('http://claw.local')).toBe('http://claw.local');
    expect(normalizeBackendUrl('https://claw.local/api/v1')).toBe('https://claw.local');
    expect(normalizeBackendUrl('https://claw.local/api/v1/')).toBe('https://claw.local');
  });

  it.each([
    'ftp://localhost',
    'http://user:password@localhost',
    'https://claw.example/api?token=secret',
    'https://claw.example/api#fragment',
    'http://claw.example',
  ])('rejects unsafe backend URL %s', (value) => {
    expect(() => normalizeBackendUrl(value)).toThrow();
  });
});

describe('.clawai configuration', () => {
  it('migrates the legacy manual value to the backend MANUAL_MODEL contract', () => {
    expect(normalizeRoutingMode('MANUAL')).toBe('MANUAL_MODEL');
    expect(normalizeRoutingMode('MANUAL_MODEL')).toBe('MANUAL_MODEL');
    expect(normalizeRoutingMode('AUTO')).toBe('AUTO');
  });

  it('accepts only documented keys and lets workspace values override global defaults', () => {
    const workspace = parseWorkspaceConfiguration({
      routingMode: 'MANUAL',
      selectedModel: 'OLLAMA:qwen3-coder',
      context: {
        maxBytes: 120_000,
        maxFiles: 20,
        exclude: ['**/fixtures/**'],
      },
    });

    expect(
      mergeConfiguration(
        {
          routingMode: 'AUTO',
          selectedModel: '',
          maxContextBytes: 200_000,
          maxContextFiles: 40,
          exclude: ['**/.env*'],
        },
        workspace,
      ),
    ).toMatchObject({
      routingMode: 'MANUAL_MODEL',
      selectedModel: 'OLLAMA:qwen3-coder',
      maxContextBytes: 120_000,
      maxContextFiles: 20,
      exclude: ['**/.env*', '**/fixtures/**'],
    });
  });

  it('rejects unknown keys instead of silently accepting misspelled security settings', () => {
    expect(() => parseWorkspaceConfiguration({ maxContextByte: 1 })).toThrow();
  });
});
