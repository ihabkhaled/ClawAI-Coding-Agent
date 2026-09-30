import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseMcpConfig } from '../../src/core/mcp/mcp-config';
import { tokenSecretKey } from '../../src/core/mcp/mcp-oauth';
import { createVscodeAuthorizationRequest } from '../../src/core/vscode-authorization';
import { runHeadlessCli } from '../../src/headless/headless-cli';
import { createMcpOAuth } from '../../src/headless/mcp/mcp-login-service';
import { openLoopbackCallback } from '../../src/headless/mcp/mcp-loopback';
import {
  defaultTokenFile,
  fileTokenStore,
  memoryTokenStore,
} from '../../src/headless/mcp/mcp-token-file';

import type { McpTokenFileFs } from '../../src/headless/mcp/mcp-login.types';
import type { AddressInfo } from 'node:net';

const cleanup: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const task of cleanup.splice(0)) await task();
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'clawai-mcp-login-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const sha256Url = (text: string): string => createHash('sha256').update(text).digest('base64url');

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector', () => {
    expect(sha256Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('gives the flow a fresh S256 challenge and an unguessable state each time', () => {
    const first = createVscodeAuthorizationRequest();
    const second = createVscodeAuthorizationRequest();

    expect(first.codeChallenge).toBe(sha256Url(first.codeVerifier));
    expect(first.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(first.state).not.toBe(second.state);
    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });
});

describe('loopback callback', () => {
  it('answers a state mismatch with 400, keeps waiting, then accepts the real redirect', async () => {
    const callback = await openLoopbackCallback('the-state', 5_000);
    cleanup.push(() => {
      callback.dispose();
    });

    const wrong = await fetch(`${callback.callbackUri}?code=evil&state=other`);
    const right = fetch(`${callback.callbackUri}?code=good&state=the-state`);

    expect(wrong.status).toBe(400);
    await expect(callback.waitForCallback()).resolves.toBe('good');
    callback.confirmAuthorization();
    expect((await right).status).toBe(200);
  });

  it('listens on 127.0.0.1 only, on an ephemeral port', async () => {
    const callback = await openLoopbackCallback('s', 5_000);
    cleanup.push(() => {
      callback.dispose();
    });

    const uri = new URL(callback.callbackUri);

    expect(uri.hostname).toBe('127.0.0.1');
    expect(Number(uri.port)).toBeGreaterThan(0);
    expect(uri.pathname).toBe('/auth/callback');
  });

  it('refuses a request whose Host is not the listener itself', async () => {
    const callback = await openLoopbackCallback('s', 5_000);
    cleanup.push(() => {
      callback.dispose();
    });
    const uri = new URL(callback.callbackUri);

    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = request(
        {
          host: uri.hostname,
          port: uri.port,
          path: `${uri.pathname}?code=x&state=s`,
          headers: { Host: 'attacker.example' },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      outgoing.on('error', reject);
      outgoing.end();
    });

    expect(status).toBe(400);
  });

  it('gives up after the hard timeout and closes the port', async () => {
    const callback = await openLoopbackCallback('s', 40);

    await expect(callback.waitForCallback()).rejects.toThrow('timed out');
    await expect(fetch(`${callback.callbackUri}?code=x&state=s`)).rejects.toThrow();
  });

  it('reports a denied authorization without echoing what the server sent', async () => {
    const callback = await openLoopbackCallback('s', 5_000);
    cleanup.push(() => {
      callback.dispose();
    });

    const answer = await fetch(`${callback.callbackUri}?error=access_denied&state=s`);

    expect(answer.status).toBe(400);
    await expect(callback.waitForCallback()).rejects.toThrow('was denied');
  });
});

describe('token file', () => {
  function recordingFs(): { fs: McpTokenFileFs; writes: { file: string; mode: number }[] } {
    const files = new Map<string, string>();
    const writes: { file: string; mode: number }[] = [];
    const fs: McpTokenFileFs = {
      readFile: (file) => Promise.resolve(files.get(file)),
      writeFile: (file, text, mode) => {
        writes.push({ file, mode });
        files.set(file, text);
        return Promise.resolve();
      },
      rename: (from, to) => {
        files.set(to, files.get(from) ?? '');
        files.delete(from);
        return Promise.resolve();
      },
      mkdir: () => Promise.resolve(),
    };
    return { fs, writes };
  }

  it('asks for mode 0600 and renames a temporary file into place', async () => {
    const { fs, writes } = recordingFs();
    const store = fileTokenStore('/home/u/.config/clawai/mcp-tokens.json', fs);

    await store.store('k', 'v');

    expect(writes).toHaveLength(1);
    expect(writes[0]?.mode).toBe(0o600);
    expect(writes[0]?.file).not.toBe('/home/u/.config/clawai/mcp-tokens.json');
    expect(await store.get('k')).toBe('v');
  });

  it('creates a real file readable by its owner only (POSIX)', async () => {
    const file = join(await tempDir(), 'sub', 'tokens.json');
    await fileTokenStore(file).store('k', 'secret');

    const mode = (await stat(file)).mode & 0o777;

    if (process.platform === 'win32') expect(mode).toBeGreaterThan(0);
    else expect(mode).toBe(0o600);
    expect(await fileTokenStore(file).get('k')).toBe('secret');
  });

  it('deletes an entry and treats a corrupt file as empty', async () => {
    const file = join(await tempDir(), 'tokens.json');
    const store = fileTokenStore(file);
    await store.store('a', '1');
    await store.store('b', '2');
    await store.delete('a');

    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('b')).toBe('2');

    await writeFile(file, '{not json');
    expect(await store.get('b')).toBeUndefined();
  });

  it.each([
    ['win32', { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, 'AppData'],
    ['darwin', {}, 'Application Support'],
    ['linux', { XDG_CONFIG_HOME: '/xdg' }, 'xdg'],
    ['linux', {}, '.config'],
    ['linux', { CLAW_CONFIG_DIR: '/custom' }, 'custom'],
  ] as const)('puts the per-user file under the %s config directory', (platform, env, part) => {
    const file = defaultTokenFile(env, platform, '/home/u');

    expect(file).toContain(part);
    expect(file.endsWith('mcp-tokens.json')).toBe(true);
    if (!('CLAW_CONFIG_DIR' in env)) expect(file).toContain('clawai');
  });

  it('a memory store seeded from a file never writes it back', async () => {
    const dir = await tempDir();
    const file = join(dir, 'ci-tokens.json');
    await fileTokenStore(file).store('k', 'seed');
    const before = await readFile(file, 'utf8');
    const memory = memoryTokenStore(file);

    await memory.store('k', 'refreshed');

    expect(await memory.get('k')).toBe('refreshed');
    expect(await readFile(file, 'utf8')).toBe(before);
  });
});

/** A local authorization server: authorize is simulated by the test, token is real HTTP. */
async function authorizationServer(): Promise<{
  origin: string;
  bodies: URLSearchParams[];
}> {
  const bodies: URLSearchParams[] = [];
  const server = createServer((incoming, response) => {
    let text = '';
    incoming.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8');
    });
    incoming.on('end', () => {
      const body = new URLSearchParams(text);
      bodies.push(body);
      response.setHeader('Content-Type', 'application/json');
      const refreshing = body.get('grant_type') === 'refresh_token';
      response.end(
        JSON.stringify({
          access_token: refreshing ? 'REFRESHED-ACCESS' : 'SECRET-ACCESS',
          refresh_token: 'SECRET-REFRESH',
          token_type: 'Bearer',
          expires_in: 3_600,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  );
  const origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  return { origin, bodies };
}

function configFor(origin: string, tokenEndpoint = `${origin}/token`): unknown {
  return {
    mcpServers: {
      remote: {
        url: `${origin}/mcp`,
        oauth: {
          clientId: 'client-1',
          authorizationEndpoint: `${origin}/authorize`,
          tokenEndpoint,
          scopes: ['read'],
        },
      },
    },
  };
}

function serverOf(config: unknown) {
  const server = parseMcpConfig(config, 'user').servers[0];
  if (server?.transport !== 'http') throw new Error('fixture must be an http server');
  return server;
}

describe('clawai --mcp-login', () => {
  it('runs the whole flow: URL printed, PKCE verified, token stored 0600, never printed', async () => {
    const as = await authorizationServer();
    const dir = await tempDir();
    const configFile = join(dir, 'mcp.json');
    const tokenFile = join(dir, 'tokens.json');
    await writeFile(configFile, JSON.stringify(configFor(as.origin)));
    const out: string[] = [];
    const err: string[] = [];
    let authorizeUrl = '';
    const openUrl = vi.fn((url: string) => {
      authorizeUrl = url;
      const query = new URL(url).searchParams;
      // The browser: follow the redirect with the code and the state it was given.
      void fetch(
        `${query.get('redirect_uri') ?? ''}?code=the-code&state=${query.get('state') ?? ''}`,
      );
    });

    const code = await runHeadlessCli(
      ['--mcp-login', 'remote', '--mcp-config', configFile, '--mcp-token-file', tokenFile],
      {},
      { stdout: (text) => out.push(text), stderr: (text) => err.push(text) },
      { cwd: dir, openUrl },
    );

    const query = new URL(authorizeUrl).searchParams;
    const exchange = as.bodies.find((body) => body.get('grant_type') === 'authorization_code');
    expect(code).toBe(0);
    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(out.join('')).toContain(authorizeUrl);
    expect(query.get('code_challenge_method')).toBe('S256');
    expect(query.get('client_id')).toBe('client-1');
    expect(exchange?.get('code')).toBe('the-code');
    expect(sha256Url(exchange?.get('code_verifier') ?? '')).toBe(query.get('code_challenge'));
    const everything = [...out, ...err].join('');
    expect(everything).not.toContain('SECRET-ACCESS');
    expect(everything).not.toContain('SECRET-REFRESH');
    expect(await readFile(tokenFile, 'utf8')).toContain('SECRET-ACCESS');
    if (process.platform !== 'win32') expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
  }, 20_000);

  it('does not try to open a browser when no terminal supplied an opener, but still prints the URL', async () => {
    const as = await authorizationServer();
    const dir = await tempDir();
    const configFile = join(dir, 'mcp.json');
    await writeFile(configFile, JSON.stringify(configFor(as.origin)));
    const out: string[] = [];

    const code = await runHeadlessCli(
      [
        '--mcp-login',
        'remote',
        '--mcp-config',
        configFile,
        '--mcp-token-file',
        join(dir, 't.json'),
      ],
      {},
      {
        stdout: (text) => {
          out.push(text);
          const match = /(http:\/\/127\.0\.0\.1:\d+\/authorize\S+)/u.exec(text);
          const query = match?.[1] === undefined ? undefined : new URL(match[1]).searchParams;
          if (query !== undefined) {
            void fetch(
              `${query.get('redirect_uri') ?? ''}?code=c&state=${query.get('state') ?? ''}`,
            );
          }
        },
        stderr: () => undefined,
      },
      { cwd: dir },
    );

    expect(code).toBe(0);
    expect(out.join('')).toContain('/authorize?');
  }, 20_000);

  it('times out with exit 1 and stores nothing when nobody answers', async () => {
    const as = await authorizationServer();
    const dir = await tempDir();
    const configFile = join(dir, 'mcp.json');
    const tokenFile = join(dir, 'tokens.json');
    await writeFile(configFile, JSON.stringify(configFor(as.origin)));
    const err: string[] = [];

    const code = await runHeadlessCli(
      ['--mcp-login', 'remote', '--mcp-config', configFile, '--mcp-token-file', tokenFile],
      {},
      { stdout: () => undefined, stderr: (text) => err.push(text) },
      { cwd: dir, login: { timeoutMs: 60 } },
    );

    expect(code).toBe(1);
    expect(err.join('')).toContain('timed out');
    await expect(stat(tokenFile)).rejects.toThrow();
  }, 20_000);

  it.each([
    ['names no such server', ['--mcp-login', 'nope'], 'no server named'],
    ['needs --mcp-config', ['--mcp-login', 'remote'], '--mcp-config'],
  ])('is a usage error when it %s', async (_name, args, message) => {
    const dir = await tempDir();
    const configFile = join(dir, 'mcp.json');
    await writeFile(configFile, JSON.stringify(configFor('http://127.0.0.1:1')));
    const err: string[] = [];
    const argv = args.includes('nope') ? [...args, '--mcp-config', configFile] : args;

    const code = await runHeadlessCli(
      argv,
      {},
      { stdout: () => undefined, stderr: (t) => err.push(t) },
      {
        cwd: dir,
      },
    );

    expect(code).toBe(2);
    expect(err.join('')).toContain(message);
  });

  it('refuses a server the config policy denies', async () => {
    const dir = await tempDir();
    const configFile = join(dir, 'mcp.json');
    await writeFile(
      configFile,
      JSON.stringify({
        ...(configFor('http://127.0.0.1:9') as object),
        policy: { deny: [{ name: 'rem*' }] },
      }),
    );

    const code = await runHeadlessCli(
      ['--mcp-login', 'remote', '--mcp-config', configFile],
      {},
      { stdout: () => undefined, stderr: () => undefined },
      { cwd: dir },
    );

    expect(code).toBe(2);
  });
});

describe('headless OAuth refresh and key binding', () => {
  const NOW = 2_000_000_000_000;

  async function storedFor(config: unknown, store = memoryTokenStore()) {
    const server = serverOf(config);
    await store.store(
      tokenSecretKey(server),
      JSON.stringify({ accessToken: 'OLD', refreshToken: 'OLD-REFRESH', expiresAt: NOW - 1 }),
    );
    return { server, store };
  }

  it('refreshes an expired token against the configured endpoint, sending the client id', async () => {
    const as = await authorizationServer();
    const config = configFor(as.origin);
    const { server, store } = await storedFor(config);
    const service = createMcpOAuth({ store, now: () => NOW });

    const token = await service.tokenProvider(server).current();

    const body = as.bodies[0];
    expect(token).toBe('REFRESHED-ACCESS');
    expect(body?.get('grant_type')).toBe('refresh_token');
    expect(body?.get('refresh_token')).toBe('OLD-REFRESH');
    expect(body?.get('client_id')).toBe('client-1');
  });

  it('never hands a stored refresh token to a different token endpoint', async () => {
    const trusted = await authorizationServer();
    const attacker = await authorizationServer();
    const { store } = await storedFor(configFor(trusted.origin));
    const swapped = serverOf(configFor(trusted.origin, `${attacker.origin}/token`));
    const service = createMcpOAuth({ store, now: () => NOW });

    const token = await service.tokenProvider(swapped).current();

    expect(tokenSecretKey(swapped)).not.toBe(tokenSecretKey(serverOf(configFor(trusted.origin))));
    expect(token).toBeUndefined();
    expect(attacker.bodies).toHaveLength(0);
  });

  it('a run never opens a browser: with no usable token the sign-in is asked for by name', async () => {
    const as = await authorizationServer();
    const server = serverOf(configFor(as.origin));
    const service = createMcpOAuth({ store: memoryTokenStore(), now: () => NOW });

    await expect(service.tokenProvider(server).renew()).rejects.toThrow('--mcp-login');
  });
});
