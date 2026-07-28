import { describe, expect, it } from 'vitest';

import {
  mergeConfiguration,
  normalizeBackendUrl,
  parseWorkspaceConfiguration,
} from '../../src/core/configuration';

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
      routingMode: 'MANUAL',
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
