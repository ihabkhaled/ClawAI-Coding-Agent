import { beforeEach, describe, expect, it, vi } from 'vitest';

const window = vi.hoisted(() => ({
  showInputBox: vi.fn(),
  showInformationMessage: vi.fn(async () => undefined),
}));
const update = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('vscode', () => ({
  l10n: { t: (message: string) => `t:${message}` },
  window,
  workspace: { getConfiguration: () => ({ update }) },
  ConfigurationTarget: { Global: 1 },
}));

import { parseTelemetryHeadersText, telemetryHeadersFrom } from '../../src/core/telemetry-headers';
import { TELEMETRY_HEADERS_SECRET_KEY } from '../../src/core/telemetry-headers.constants';
import { postOtlp } from '../../src/infrastructure/otlp-post';
import { otlpSink } from '../../src/services/otlp-sink-factory';
import { TelemetryHeaderStore } from '../../src/services/telemetry-header-store';
import {
  setTelemetryHeaders,
  startTelemetryHeaders,
} from '../../src/services/telemetry-headers-command';
import { testRuntimeConfiguration } from '../helpers/runtime-configuration';

import type { OutputLogger } from '../../src/infrastructure/output-logger';

const TOKEN = 'Bearer super-secret-token';

function secrets(initial?: string) {
  let value = initial;
  let listener: ((event: { key: string }) => void) | undefined;
  return {
    get: vi.fn(async (_key: string) => value),
    store: vi.fn(async (_key: string, next: string) => {
      value = next;
    }),
    delete: vi.fn(async (_key: string) => {
      value = undefined;
    }),
    onDidChange: vi.fn((next: (event: { key: string }) => void) => {
      listener = next;
      return { dispose: vi.fn() };
    }),
    fire: (key: string) => listener?.({ key }),
    current: () => value,
  };
}

function log() {
  return { warn: vi.fn(), info: vi.fn() };
}

function everyLogArgument(logger: ReturnType<typeof log>): string {
  return JSON.stringify([...logger.warn.mock.calls, ...logger.info.mock.calls]);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('telemetry header validation', () => {
  it('accepts an object of header names to text', () => {
    expect(telemetryHeadersFrom({ authorization: TOKEN, 'x-team': 'a' })).toEqual({
      authorization: TOKEN,
      'x-team': 'a',
    });
  });

  it('refuses the whole value when any entry is unusable', () => {
    expect(telemetryHeadersFrom({ authorization: TOKEN, 'bad name': 'x' })).toBeUndefined();
    expect(telemetryHeadersFrom({ authorization: 'a\r\nInjected: 1' })).toBeUndefined();
    expect(telemetryHeadersFrom({ authorization: 5 })).toBeUndefined();
    expect(telemetryHeadersFrom({ big: 'x'.repeat(8_193) })).toBeUndefined();
    expect(telemetryHeadersFrom([TOKEN])).toBeUndefined();
    expect(telemetryHeadersFrom(null)).toBeUndefined();
    const many = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`h${String(index)}`, 'v']),
    );
    expect(telemetryHeadersFrom(many)).toBeUndefined();
  });

  it('parses JSON text and refuses text that is not JSON', () => {
    expect(parseTelemetryHeadersText(`{"authorization":"${TOKEN}"}`)).toEqual({
      authorization: TOKEN,
    });
    expect(parseTelemetryHeadersText('authorization: x')).toBeUndefined();
  });
});

describe('TelemetryHeaderStore', () => {
  it('saves to SecretStorage and updates the live object in place', async () => {
    const storage = secrets();
    const store = new TelemetryHeaderStore(storage);
    const live = store.headers;

    await store.save({ authorization: TOKEN });

    expect(storage.store).toHaveBeenCalledWith(
      TELEMETRY_HEADERS_SECRET_KEY,
      JSON.stringify({ authorization: TOKEN }),
    );
    expect(live).toEqual({ authorization: TOKEN });
    await store.clear();
    expect(storage.delete).toHaveBeenCalledWith(TELEMETRY_HEADERS_SECRET_KEY);
    expect(live).toEqual({});
  });

  it('loads what is stored, and treats an unreadable value as none', async () => {
    const good = new TelemetryHeaderStore(secrets(JSON.stringify({ authorization: TOKEN })));
    await good.load();
    expect(good.headers).toEqual({ authorization: TOKEN });

    const corrupt = new TelemetryHeaderStore(secrets('{not json'));
    await corrupt.load();
    expect(corrupt.headers).toEqual({});

    const empty = new TelemetryHeaderStore(secrets());
    await empty.load();
    expect(empty.headers).toEqual({});
  });

  it('moves the old setting into SecretStorage once and clears the setting', async () => {
    const storage = secrets();
    const store = new TelemetryHeaderStore(storage);
    const clear = vi.fn(async () => undefined);
    const logger = log();

    await store.migrate({ read: () => ({ authorization: TOKEN }), clear }, logger);

    expect(storage.current()).toBe(JSON.stringify({ authorization: TOKEN }));
    expect(clear).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledOnce();
    expect(everyLogArgument(logger)).not.toContain('super-secret');
  });

  it('keeps an existing keychain value over the old setting, and still clears it', async () => {
    const storage = secrets(JSON.stringify({ authorization: 'Bearer kept' }));
    const store = new TelemetryHeaderStore(storage);
    const clear = vi.fn(async () => undefined);

    await store.migrate({ read: () => ({ authorization: TOKEN }), clear }, log());

    expect(storage.store).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
  });

  it('removes an invalid old setting without moving it', async () => {
    const storage = secrets();
    const clear = vi.fn(async () => undefined);
    const logger = log();

    await new TelemetryHeaderStore(storage).migrate(
      { read: () => ({ 'bad name': TOKEN }), clear },
      logger,
    );

    expect(storage.store).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(everyLogArgument(logger)).not.toContain('super-secret');
  });

  it('does nothing when the old setting is empty', async () => {
    const storage = secrets();
    const clear = vi.fn(async () => undefined);

    await new TelemetryHeaderStore(storage).migrate({ read: () => ({}), clear }, log());

    expect(storage.get).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });
});

describe('ClawAI: Set Telemetry Headers', () => {
  beforeEach(() => {
    window.showInputBox.mockReset();
    window.showInformationMessage.mockClear();
  });

  it('stores typed headers in the keychain from a password box', async () => {
    window.showInputBox.mockResolvedValue(`{"authorization":"${TOKEN}"}`);
    const storage = secrets();

    await setTelemetryHeaders(new TelemetryHeaderStore(storage));

    expect(window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ password: true }));
    expect(storage.current()).toBe(JSON.stringify({ authorization: TOKEN }));
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      't:Telemetry headers saved to the OS keychain.',
    );
    expect(JSON.stringify(window.showInformationMessage.mock.calls)).not.toContain('super-secret');
  });

  it('removes the headers on an empty entry', async () => {
    window.showInputBox.mockResolvedValue('   ');
    const storage = secrets(JSON.stringify({ authorization: TOKEN }));

    await setTelemetryHeaders(new TelemetryHeaderStore(storage));

    expect(storage.current()).toBeUndefined();
    expect(window.showInformationMessage).toHaveBeenCalledWith('t:Telemetry headers removed.');
  });

  it('changes nothing when cancelled or given text that slipped past validation', async () => {
    const storage = secrets();
    window.showInputBox.mockResolvedValueOnce(undefined).mockResolvedValueOnce('not json');

    await setTelemetryHeaders(new TelemetryHeaderStore(storage));
    await setTelemetryHeaders(new TelemetryHeaderStore(storage));

    expect(storage.store).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('validates the typed text, allowing empty to mean remove', async () => {
    window.showInputBox.mockResolvedValue(undefined);
    await setTelemetryHeaders(new TelemetryHeaderStore(secrets()));
    const options: { validateInput: (value: string) => string | undefined } | undefined =
      window.showInputBox.mock.calls[0]?.[0];

    expect(options?.validateInput('')).toBeUndefined();
    expect(options?.validateInput('{"authorization":"x"}')).toBeUndefined();
    expect(options?.validateInput('[1]')).toMatch(/^t:Enter a JSON object/u);
  });
});

describe('startTelemetryHeaders', () => {
  it('migrates, loads, and reloads when the secret changes in another window', async () => {
    update.mockClear();
    const storage = secrets();
    const context = { secrets: storage, subscriptions: [] as { dispose(): unknown }[] };
    const logger = log();

    const store = startTelemetryHeaders(context, () => ({ authorization: TOKEN }), logger);
    await settle();

    expect(store.headers).toEqual({ authorization: TOKEN });
    expect(update).toHaveBeenCalledWith('telemetryHeaders', undefined, 1);
    expect(context.subscriptions).toHaveLength(1);

    await storage.store(TELEMETRY_HEADERS_SECRET_KEY, JSON.stringify({ 'x-other': 'v' }));
    storage.fire('some.other.key');
    await settle();
    expect(store.headers).toEqual({ authorization: TOKEN });
    storage.fire(TELEMETRY_HEADERS_SECRET_KEY);
    await settle();
    expect(store.headers).toEqual({ 'x-other': 'v' });
  });

  it('logs, without the value, when the keychain cannot be read', async () => {
    const storage = secrets();
    storage.get.mockRejectedValue(new Error(`keychain locked ${TOKEN}`));
    const logger = log();

    startTelemetryHeaders({ secrets: storage, subscriptions: [] }, () => ({}), logger);
    await settle();

    expect(logger.warn).toHaveBeenCalledWith(
      'ClawAI telemetry headers could not be read from the OS keychain.',
    );
    expect(everyLogArgument(logger)).not.toContain('super-secret');
  });
});

describe('otlpSink headers', () => {
  function logger(): OutputLogger {
    return { warn: vi.fn(), info: vi.fn() } as never;
  }

  it('builds a sink for a configured endpoint', () => {
    const configuration = {
      ...testRuntimeConfiguration(),
      telemetryEndpoint: 'https://otel.example.test/v1/traces',
    };

    const sink = otlpSink(configuration, logger(), '1.0.0', {
      secrets: secrets(),
      subscriptions: [],
    });

    expect(sink).toEqual(expect.objectContaining({ dispose: expect.any(Function) }));
  });

  it('posts whatever the keychain holds at send time, set after the sink was built', async () => {
    const store = new TelemetryHeaderStore(secrets());
    const endpoint = { url: 'https://otel.example.test/v1/traces', headers: store.headers };
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));

    await store.save({ authorization: 'Bearer from-keychain' });
    await postOtlp(send, endpoint, endpoint.url, '{}', logger());

    expect(send.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: 'Bearer from-keychain',
    });
  });

  it('still migrates the old setting when no endpoint is configured', async () => {
    update.mockClear();
    const storage = secrets();
    const configuration = {
      ...testRuntimeConfiguration(),
      telemetryHeaders: { authorization: TOKEN },
    };

    const sink = otlpSink(configuration, logger(), '1.0.0', {
      secrets: storage,
      subscriptions: [],
    });
    await settle();

    expect(sink).toBeUndefined();
    expect(storage.current()).toBe(JSON.stringify({ authorization: TOKEN }));
    expect(update).toHaveBeenCalledOnce();
  });
});
