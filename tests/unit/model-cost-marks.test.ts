import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...values: (number | string)[]) =>
      values.reduce<string>(
        (result, value, index) => result.replace(`{${String(index)}}`, String(value)),
        message,
      ),
  },
}));

import { fetchModelAccess } from '../../src/backend/model-access-client';
import { MODEL_ACCESS_MAX_MODELS } from '../../src/backend/model-access-client.constants';
import { accessQueries, isModelDimmed, mergeModelAccess } from '../../src/core/model-access-merge';
import { RunTelemetryRecorder } from '../../src/core/run-telemetry';
import { STUCK_FAILURE_CODE } from '../../src/core/runtime/runtime-repetition.constants';
import { ModelService, type ModelBackendPort } from '../../src/services/model-service';
import { localizedFailure } from '../../src/services/runtime-failure-wording';
import { fallbackReasonFor } from '../../src/services/runtime-studio-fallback-notice';
import { publicModelEntry } from '../../src/webview/chat-public-state';

import type { ModelAccessRequester } from '../../src/backend/model-access-client.types';
import type { ModelCatalogEntry } from '../../src/core/model-catalog';
import type { RuntimeEvent } from '../../src/core/runtime/runtime-protocol.schemas';

function entry(provider: string, model: string, isLocal = false): ModelCatalogEntry {
  return {
    id: `${provider}-${model}`,
    key: `${provider}:${model}`,
    provider,
    model,
    displayName: model,
    isLocal,
    source: 'routing',
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    supportsStructuredOutput: false,
    contextTokens: null,
  };
}

const requester = (impl: (body: unknown) => unknown): ModelAccessRequester =>
  (async (
    _path: string,
    schema: { parse: (value: unknown) => unknown },
    options: { body: unknown },
  ) => schema.parse(impl(options.body))) as unknown as ModelAccessRequester;

describe('fetchModelAccess', () => {
  it('posts the models and returns the entries, an unknown band reading as absent', async () => {
    const post = vi.fn((_body: unknown) => [
      {
        provider: 'GEMINI',
        model: 'a',
        allowed: true,
        costClass: 'CHEAP',
        coveredByAllowance: true,
      },
      { provider: 'GEMINI', model: 'b', allowed: true, costClass: 'SURPRISE' },
    ]);
    const entries = await fetchModelAccess(requester(post), [
      { provider: 'GEMINI', model: 'a' },
      { provider: 'GEMINI', model: 'b' },
    ]);
    expect(post).toHaveBeenCalledWith({
      models: [
        { provider: 'GEMINI', model: 'a' },
        { provider: 'GEMINI', model: 'b' },
      ],
    });
    expect(entries[0]).toMatchObject({ costClass: 'CHEAP', coveredByAllowance: true });
    expect(entries[1]?.costClass).toBeUndefined();
  });

  it('splits a long list into chunks the backend accepts', async () => {
    const sizes: number[] = [];
    const models = Array.from({ length: MODEL_ACCESS_MAX_MODELS + 5 }, (_, i) => ({
      provider: 'P',
      model: `m${String(i)}`,
    }));
    await fetchModelAccess(
      requester((body) => {
        sizes.push((body as { models: unknown[] }).models.length);
        return [];
      }),
      models,
    );
    expect(sizes).toEqual([MODEL_ACCESS_MAX_MODELS, 5]);
  });

  it('fails open: a refused chunk yields nothing and the others still count', async () => {
    let call = 0;
    const models = Array.from({ length: MODEL_ACCESS_MAX_MODELS + 1 }, (_, i) => ({
      provider: 'P',
      model: `m${String(i)}`,
    }));
    const entries = await fetchModelAccess(
      requester(() => {
        call += 1;
        if (call === 1) throw new Error('404');
        return [{ provider: 'P', model: 'last', allowed: true }];
      }),
      models,
    );
    expect(entries).toEqual([{ provider: 'P', model: 'last', allowed: true }]);
  });

  it('fails open on an answer of the wrong shape', async () => {
    const entries = await fetchModelAccess(
      requester(() => ({ not: 'a list' })),
      [{ provider: 'P', model: 'm' }],
    );
    expect(entries).toEqual([]);
  });
});

describe('mergeModelAccess and the dim rule', () => {
  const catalog = [entry('GEMINI', 'a'), entry('GEMINI', 'b'), entry('local-ollama', 'l', true)];

  it('marks only what the backend said and leaves the rest untouched', () => {
    const merged = mergeModelAccess(catalog, [
      {
        provider: 'GEMINI',
        model: 'a',
        allowed: true,
        costClass: 'PREMIUM',
        coveredByAllowance: false,
      },
      { provider: 'GEMINI', model: 'b', allowed: true },
    ]);
    expect(merged[0]).toMatchObject({ costClass: 'PREMIUM', coveredByAllowance: false });
    expect(merged[1]).not.toHaveProperty('costClass');
    expect(merged[1]).not.toHaveProperty('coveredByAllowance');
    expect(merged[2]).toBe(catalog[2]);
  });

  it('is the identity when the backend sent nothing', () => {
    expect(mergeModelAccess(catalog, [])).toEqual(catalog);
  });

  it('dims on coveredByAllowance false or allowed false, never when unknown or true', () => {
    expect(isModelDimmed({ coveredByAllowance: false })).toBe(true);
    expect(isModelDimmed({ allowed: false })).toBe(true);
    expect(isModelDimmed({ allowed: true, coveredByAllowance: true })).toBe(false);
    expect(isModelDimmed({})).toBe(false);
  });

  it('asks only about non-local models', () => {
    expect(accessQueries(catalog)).toEqual([
      { provider: 'GEMINI', model: 'a' },
      { provider: 'GEMINI', model: 'b' },
    ]);
  });

  it('publishes the band and the dim flag, and nothing when there is none', () => {
    const marked = publicModelEntry({
      ...entry('GEMINI', 'a'),
      costClass: 'ULTRA',
      coveredByAllowance: false,
    });
    expect(marked).toMatchObject({ costClass: 'ULTRA', dimmed: true });
    const plain = publicModelEntry(entry('GEMINI', 'b'));
    expect(plain).not.toHaveProperty('costClass');
    expect(plain).not.toHaveProperty('dimmed');
  });
});

describe('ModelService access hints', () => {
  const routerModel = {
    id: 'r1',
    provider: 'GEMINI',
    modelKey: 'flash',
    displayName: 'Flash',
    isLocal: false,
    isExecutionCapable: true,
    lifecycle: 'ACTIVE',
  };
  const entitlements = {
    userId: 'u',
    role: 'USER',
    isAdmin: true,
    permissions: [],
    plan: null,
    allowedModels: [],
    allowedProviders: [],
    quota: { dailyLimit: 1, used: 0, remaining: 1, unlimited: false },
  };
  const port = (access?: ModelBackendPort['getModelAccess']): ModelBackendPort => ({
    getRouterModels: vi.fn(async () => [routerModel]),
    getConnectorModels: vi.fn(async () => []),
    getLocalOllamaModels: vi.fn(async () => []),
    getLocalFrontierModels: vi.fn(async () => []),
    getEntitlements: vi.fn(async () => entitlements),
    getOrganizationPolicy: vi.fn(async () => undefined),
    ...(access === undefined ? {} : { getModelAccess: access }),
  });

  it('puts the band on the catalog', async () => {
    const result = await new ModelService(
      port(async () => [
        { provider: 'GEMINI', model: 'flash', allowed: true, costClass: 'CHEAP' as const },
      ]),
    ).refresh();
    expect(result.catalog[0]).toMatchObject({ costClass: 'CHEAP', allowed: true });
  });

  it('keeps the catalog when the access call throws', async () => {
    const result = await new ModelService(
      port(async () => {
        throw new Error('down');
      }),
    ).refresh();
    expect(result.catalog).toHaveLength(1);
    expect(result.catalog[0]).not.toHaveProperty('costClass');
  });

  it('keeps the catalog when the port has no access call', async () => {
    const result = await new ModelService(port()).refresh();
    expect(result.catalog).toHaveLength(1);
  });
});

describe('cache-write in Runtime V2 usage', () => {
  const event = (payload: Record<string, unknown>): RuntimeEvent =>
    ({ type: 'model.completed', payload, timestamp: 't' }) as unknown as RuntimeEvent;

  it('adds up what the backend sent and omits the field when it sent none', () => {
    const recorder = new RunTelemetryRecorder('r', 's');
    recorder.observe(event({ inputTokens: 5 }));
    expect(recorder.usage('r', 'ok', 'a', 'b')).not.toHaveProperty('cacheWriteTokens');
    recorder.observe(event({ cacheCreationPromptTokens: 100.9 }));
    recorder.observe(event({ cacheCreationPromptTokens: 20 }));
    recorder.observe(event({ cacheCreationPromptTokens: -4 }));
    recorder.observe(event({ cacheCreationPromptTokens: 'x' }));
    expect(recorder.usage('r', 'ok', 'a', 'b').cacheWriteTokens).toBe(120);
  });
});

describe('plan and credit wording', () => {
  it('names the account, not a busy model, for a plan or credit code', () => {
    expect(fallbackReasonFor('PLAN_DAILY_CHAT_LIMIT_EXCEEDED')).toBe('plan');
    expect(fallbackReasonFor('Over (QUOTA_EXCEEDED)')).toBe('plan');
    expect(fallbackReasonFor('PAYG_CREDIT_EXHAUSTED')).toBe('credit');
    expect(fallbackReasonFor('429 Too Many Requests')).toBe('rate-limit');
  });

  it('words a plan limit, a credit limit and a stuck run, and leaves other failures alone', () => {
    expect(localizedFailure('PLAN_DAILY_CHAT_LIMIT_EXCEEDED', 'x')).toContain(
      'plan limit is reached (PLAN_DAILY_CHAT_LIMIT_EXCEEDED)',
    );
    expect(localizedFailure('INSUFFICIENT_CREDIT', 'x')).toContain('credit is used up');
    expect(
      localizedFailure(
        STUCK_FAILURE_CODE,
        'The run was stopped: it made the same workspace.files read call 8 times and nothing changed.',
      ),
    ).toBe(
      'The run was stopped: it made the same workspace.files read call 8 times and nothing changed.',
    );
    expect(localizedFailure(STUCK_FAILURE_CODE, 'something else')).toBeUndefined();
    expect(localizedFailure('CONNECTOR_CONFIG_FETCH_FAILED', 'boom')).toBeUndefined();
  });
});

/**
 * `media/chat.js` is a plain browser script, so its pure helpers are lifted out
 * of the source and run against a stub label set. This pins the wording of the
 * token tooltip and the cost mark without a browser.
 */
function chatFunctions(names: readonly string[]): Record<string, (...args: never[]) => unknown> {
  const source = readFileSync(
    fileURLToPath(new URL('../../media/chat.js', import.meta.url)),
    'utf8',
  );
  const pick = (name: string): string => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found in chat.js`);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`${name} is not closed`);
  };
  const constStart = source.indexOf('const COST_BANDS = {');
  const constBlock = source.slice(constStart, source.indexOf('};', constStart) + 2);
  const labels = {
    tokenDetail: 'Input {0} · Output {1}',
    tokenCached: '{0} cached ({1}%)',
    tokenCacheWrite: '{0} written to cache',
    costFree: 'Free',
    costCheap: 'Low cost',
    costStandard: 'Standard cost',
    costPremium: 'Premium cost',
    costUltra: 'Highest cost',
    modelDimmed: 'Not covered by your plan allowance',
  };
  const body = `${constBlock}\n${['translatedTemplate', ...names].map(pick).join('\n')}\nreturn { ${names.join(', ')} };`;
  return runInNewContext(`(() => {${body}})()`, { labels }) as Record<
    string,
    (...args: never[]) => unknown
  >;
}

describe('panel helpers in media/chat.js', () => {
  const chat = chatFunctions(['tokenTooltip', 'costBand', 'modelOptionText', 'modelOptionHint']);
  const tooltip = chat.tokenTooltip as (receipt: object) => string;
  const optionText = chat.modelOptionText as (model: object) => string;
  const optionHint = chat.modelOptionHint as (model: object) => string;

  it('shows the cache-write count in the token tooltip, after the cached share', () => {
    expect(tooltip({ input: 1000, output: 10, cached: 500, cacheWrite: 200 })).toBe(
      'Input 1000 · Output 10 · 500 cached (50%) · 200 written to cache',
    );
  });

  it('shows cache write alone, and nothing for zero or absent', () => {
    expect(tooltip({ input: 100, output: 1, cached: 0, cacheWrite: 40 })).toBe(
      'Input 100 · Output 1 · 40 written to cache',
    );
    expect(tooltip({ input: 100, output: 1, cached: 0, cacheWrite: 0 })).toBe(
      'Input 100 · Output 1',
    );
    expect(tooltip({ input: 100, output: 1, cached: 0 })).toBe('Input 100 · Output 1');
  });

  it('marks the model with its band only, never a rate', () => {
    expect(optionText({ displayName: 'Flash', costClass: 'CHEAP' })).toBe('Flash · $');
    expect(optionText({ displayName: 'Opus', costClass: 'ULTRA' })).toBe('Opus · $$$$');
    expect(optionText({ displayName: 'Gem', costClass: 'FREE' })).toBe('Gem · 0');
  });

  it('shows no mark without a band or with one it does not know', () => {
    expect(optionText({ displayName: 'Flash' })).toBe('Flash');
    expect(optionText({ displayName: 'Flash', costClass: 'WEIRD' })).toBe('Flash');
    expect(optionHint({ displayName: 'Flash' })).toBe('');
  });

  it('explains the band and the dim in the hover text', () => {
    expect(optionHint({ costClass: 'PREMIUM' })).toBe('Premium cost');
    expect(optionHint({ costClass: 'STANDARD', dimmed: true })).toBe(
      'Standard cost · Not covered by your plan allowance',
    );
    expect(optionHint({ dimmed: true })).toBe('Not covered by your plan allowance');
  });
});
