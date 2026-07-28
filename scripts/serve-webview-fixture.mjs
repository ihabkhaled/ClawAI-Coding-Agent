import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import process, { cwd, stdout } from 'node:process';

import { transform } from 'esbuild';

const root = cwd();
const nonce = 'playwright-fixture-nonce';
const markupSource = readFileSync(join(root, 'src', 'webview', 'chat-markup.ts'), 'utf8');
const transformed = await transform(markupSource, {
  format: 'esm',
  loader: 'ts',
  target: 'es2022',
});
const markupModule = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`
);
const bridge = `<script nonce="${nonce}">
window.__clawMock = {
  messages: [],
  send(message) {
    window.dispatchEvent(new MessageEvent('message', { data: message }));
  }
};
window.acquireVsCodeApi = () => ({
  postMessage(message) {
    window.__clawMock.messages.push(message);
  }
});
</script>`;
const baseHtml = markupModule.renderChatMarkup({
  cspSource: "'self'",
  language: 'en',
  logoUri: '/resources/icon.png',
  nonce,
  scriptUri: '/media/chat.js',
  styleUri: '/media/chat.css',
  translate: (message) => message,
});
const html = baseHtml
  .replace('</head>', '  <link href="/tests/playwright/theme.css" rel="stylesheet">\n</head>')
  .replace(
    `<script nonce="${nonce}" src="/media/chat.js"></script>`,
    `${bridge}
  <script nonce="${nonce}" src="/media/chat.js"></script>`,
  );
const assets = new Map([
  ['/', { body: html, type: 'text/html; charset=utf-8' }],
  [
    '/resources/icon.png',
    {
      body: readFileSync(join(root, 'resources', 'icon.png')),
      type: 'image/png',
    },
  ],
  [
    '/media/chat.css',
    {
      body: readFileSync(join(root, 'media', 'chat.css')),
      type: 'text/css; charset=utf-8',
    },
  ],
  [
    '/media/chat.js',
    {
      body: readFileSync(join(root, 'media', 'chat.js')),
      type: 'text/javascript; charset=utf-8',
    },
  ],
  [
    '/tests/playwright/theme.css',
    {
      body: readFileSync(join(root, 'tests', 'playwright', 'theme.css')),
      type: 'text/css; charset=utf-8',
    },
  ],
]);

const server = createServer((request, response) => {
  const asset = assets.get(request.url ?? '/');
  if (asset === undefined) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': asset.type,
  });
  response.end(asset.body);
});

server.listen(4178, '127.0.0.1', () => {
  stdout.write('ClawAI webview fixture listening on http://127.0.0.1:4178\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
