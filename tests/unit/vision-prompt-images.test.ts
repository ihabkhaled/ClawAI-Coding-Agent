import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseHeadlessArgs } from '../../src/headless/headless-args';
import { textLine } from '../../src/headless/headless-output';
import { HeadlessTransport } from '../../src/headless/headless-transport';
import { runAgent } from '../../src/sdk/agent-sdk';
import { createAgent } from '../../src/sdk/create-agent';
import { loadPromptImages, uploadPromptImages } from '../../src/sdk/prompt-images';
import { redRectanglePng } from '../helpers/png-fixture';

import type { HeadlessRunRequest } from '../../src/headless/headless-transport.types';
import type { RuntimeTransportPort } from '../../src/sdk/agent-sdk.types';

const created: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of created.splice(0)) rmSync(directory, { force: true, recursive: true });
});

function folder(): string {
  const made = mkdtempSync(path.join(tmpdir(), 'claw-prompt-images-'));
  created.push(made);
  return made;
}

function image(root: string, name = 'shot.png'): string {
  writeFileSync(path.join(root, name), redRectanglePng());
  return name;
}

function fakeTransport(withUpload = true) {
  const started: HeadlessRunRequest[] = [];
  const uploaded: { token: string; filename: string; size: number }[] = [];
  const transport: RuntimeTransportPort = {
    signIn: async () => Promise.resolve('tok'),
    createThread: async () => Promise.resolve('thread-1'),
    ...(withUpload
      ? {
          uploadImage: async (token, picture) => {
            uploaded.push({ token, filename: picture.filename, size: picture.bytes.length });
            return Promise.resolve(`file-${String(uploaded.length)}`);
          },
        }
      : {}),
    startRun: async (_token, body) => {
      started.push(body);
      return Promise.resolve({ runId: 'run-1', generation: 'gen-1' });
    },
    submitResult: async () => Promise.resolve({}),
    events: async function* stream() {
      yield await Promise.resolve({ type: 'run.completed' });
    },
  };
  return { transport, started, uploaded };
}

describe('loadPromptImages', () => {
  it('reads relative paths from the base and returns checked images', () => {
    const root = folder();
    const images = loadPromptImages([image(root)], root);
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe('image/png');
  });

  it('is a usage error (RangeError) for a bad file, so the CLI exits 2 before any request', () => {
    const root = folder();
    writeFileSync(path.join(root, 'bad.png'), 'not an image');
    expect(() => loadPromptImages(['bad.png'], root)).toThrow(RangeError);
    expect(() => loadPromptImages(['missing.png'], root)).toThrow(/does not exist/u);
    expect(() => loadPromptImages(['.env.png'], root)).toThrow(RangeError);
  });

  it('allows at most four images', () => {
    const root = folder();
    const names = ['a', 'b', 'c', 'd', 'e'].map((stem) => image(root, `${stem}.png`));
    expect(() => loadPromptImages(names, root)).toThrow(/At most 4/u);
    expect(loadPromptImages(names.slice(0, 4), root)).toHaveLength(4);
  });
});

describe('uploadPromptImages', () => {
  it('returns nothing to send when there are no images', async () => {
    const { transport } = fakeTransport();
    expect(await uploadPromptImages(transport, 'tok', undefined)).toEqual({});
    expect(await uploadPromptImages(transport, 'tok', [])).toEqual({});
  });

  it('says it cannot attach images rather than dropping them', async () => {
    const root = folder();
    const images = loadPromptImages([image(root)], root);
    await expect(uploadPromptImages(fakeTransport(false).transport, 'tok', images)).rejects.toThrow(
      /cannot attach images/u,
    );
  });
});

describe('runAgent with images', () => {
  it('uploads each image and names the files in the run request', async () => {
    const root = folder();
    const images = loadPromptImages([image(root), image(root, 'two.png')], root);
    const { transport, started, uploaded } = fakeTransport();
    await runAgent({
      prompt: 'look',
      toolkit: { definitions: [], execute: () => ({}) },
      token: 'tok',
      transport,
      images,
    });
    expect(uploaded.map((entry) => entry.filename)).toEqual(['shot.png', 'two.png']);
    expect(uploaded[0]?.token).toBe('tok');
    expect(started[0]?.fileIds).toEqual(['file-1', 'file-2']);
  });

  it('sends no fileIds field when there are no images', async () => {
    const { transport, started } = fakeTransport();
    await runAgent({
      prompt: 'p',
      toolkit: { definitions: [], execute: () => ({}) },
      token: 'tok',
      transport,
    });
    expect('fileIds' in (started[0] ?? {})).toBe(false);
  });
});

describe('createAgent images', () => {
  it('attaches them to the first run only', async () => {
    const root = folder();
    const { transport, started } = fakeTransport();
    const agent = createAgent({
      auth: { token: 'tok' },
      workspaceRoot: root,
      transport,
      images: [image(root)],
    });
    await agent.run('first');
    await agent.run('second');
    expect(started).toHaveLength(2);
    expect(started[0]?.fileIds).toEqual(['file-1']);
    expect(started[1]?.fileIds).toBeUndefined();
  });

  it('refuses to build with a bad image, before any request', () => {
    const root = folder();
    const { transport, started } = fakeTransport();
    expect(() =>
      createAgent({ auth: { token: 'tok' }, workspaceRoot: root, transport, images: ['nope.png'] }),
    ).toThrow(RangeError);
    expect(started).toHaveLength(0);
  });
});

describe('HeadlessTransport.uploadImage', () => {
  it('posts the file API body and returns the id', async () => {
    const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: JSON.parse(String(init.body)) as Record<string, unknown>,
        auth: new Headers(init.headers).get('authorization'),
      });
      return Promise.resolve(new Response(JSON.stringify({ id: 'f-9' }), { status: 201 }));
    });
    const root = folder();
    const [picture] = loadPromptImages([image(root)], root);
    if (picture === undefined) throw new Error('no image');
    const id = await new HeadlessTransport('https://claw.test/api/v1').uploadImage('tok', picture);
    expect(id).toBe('f-9');
    expect(calls[0]?.url).toBe('https://claw.test/api/v1/files/upload');
    expect(calls[0]?.auth).toBe('Bearer tok');
    expect(calls[0]?.body).toEqual({
      content: picture.bytes.toString('base64'),
      filename: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: picture.bytes.length,
    });
  });
});

describe('--image, --vision and --vision-model flags', () => {
  const cwd = path.resolve('/work');
  const invocation = (argv: string[]) => {
    const parsed = parseHeadlessArgs(['-p', 'x', ...argv], {}, cwd);
    if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
    return parsed.invocation;
  };

  it('collects repeated --image paths as absolute paths and turns vision on', () => {
    const run = invocation(['--image', 'a.png', '--image', 'sub/b.webp']);
    expect(run.images).toEqual([path.resolve(cwd, 'a.png'), path.resolve(cwd, 'sub/b.webp')]);
    expect(run.vision).toBe(true);
  });

  it('turns vision on for --vision-model and for --vision alone', () => {
    expect(invocation(['--vision-model', 'openai/gpt-4.1-mini'])).toMatchObject({
      vision: true,
      visionModel: 'openai/gpt-4.1-mini',
    });
    expect(invocation(['--vision']).vision).toBe(true);
  });

  it('leaves vision off by default', () => {
    const run = invocation([]);
    expect(run.vision).toBeUndefined();
    expect(run.images).toBeUndefined();
  });

  it('refuses more than four images', () => {
    const parsed = parseHeadlessArgs(
      ['-p', 'x', ...['a', 'b', 'c', 'd', 'e'].flatMap((stem) => ['--image', `${stem}.png`])],
      {},
      cwd,
    );
    expect(parsed).toMatchObject({ kind: 'usage' });
  });

  it('needs a value after --image', () => {
    expect(parseHeadlessArgs(['-p', 'x', '--image'], {}, cwd)).toMatchObject({ kind: 'usage' });
  });
});

describe('telling the operator when the backend dropped the attachments', () => {
  function withKept(kept: readonly string[] | undefined | Error) {
    const base = fakeTransport();
    const transport: RuntimeTransportPort = {
      ...base.transport,
      attachedFileIds: async () => {
        if (kept instanceof Error) return Promise.reject(kept);
        return Promise.resolve(kept);
      },
    };
    return { ...base, transport };
  }

  async function dropped(kept: readonly string[] | undefined | Error): Promise<unknown[]> {
    const root = folder();
    const { transport } = withKept(kept);
    const events: unknown[] = [];
    const agent = createAgent({
      auth: { token: 'tok' },
      workspaceRoot: root,
      transport,
      images: [image(root)],
    });
    await agent.run('look', { onEvent: (event) => events.push(event) });
    return events.filter((event) => (event as { type: string }).type === 'images.not-delivered');
  }

  it('emits images.not-delivered when the backend kept none of them', async () => {
    expect(await dropped([])).toEqual([{ type: 'images.not-delivered', sent: 1, delivered: 0 }]);
  });

  it('stays quiet when they were kept', async () => {
    expect(await dropped(['file-1'])).toEqual([]);
  });

  it('stays quiet when the backend cannot tell, or the lookup fails', async () => {
    expect(await dropped(undefined)).toEqual([]);
    expect(await dropped(new Error('HTTP 500'))).toEqual([]);
  });
});

describe('HeadlessTransport.attachedFileIds', () => {
  function listing(data: unknown[]) {
    vi.stubGlobal('fetch', async () =>
      Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 })),
    );
  }
  const run = { threadId: 't1', runId: 'run-1' };
  const prompt = (runId: string, extra: Record<string, unknown>) => ({
    role: 'USER',
    metadata: { runtimeV2: { runId }, ...extra },
  });

  it("returns the ids stored on this run's prompt message", async () => {
    listing([prompt('run-0', { fileIds: ['old'] }), prompt('run-1', { fileIds: ['a', 'b'] })]);
    expect(await new HeadlessTransport('https://x/api/v1').attachedFileIds('t', run)).toEqual([
      'a',
      'b',
    ]);
  });

  it('returns an empty list when the prompt message has no attachments', async () => {
    listing([prompt('run-1', {})]);
    expect(await new HeadlessTransport('https://x/api/v1').attachedFileIds('t', run)).toEqual([]);
  });

  it('returns undefined when the prompt message is not in the listing', async () => {
    listing([{ role: 'ASSISTANT', metadata: {} }]);
    expect(
      await new HeadlessTransport('https://x/api/v1').attachedFileIds('t', run),
    ).toBeUndefined();
  });
});

describe('the operator line for dropped images', () => {
  it('says how many were kept and what still works', () => {
    const line = textLine({ type: 'images.not-delivered', sent: 2, delivered: 0 });
    expect(line).toContain('kept 0 of 2');
    expect(line).toContain('vision.describe');
  });
});
