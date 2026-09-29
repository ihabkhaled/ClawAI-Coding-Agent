// A minimal MCP stdio server for tests: newline-delimited JSON-RPC 2.0.
import { createInterface } from 'node:readline';
import process from 'node:process';

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = createInterface({ input: process.stdin });

const firstPage = [
  { name: 'echo', description: 'Echo text back', inputSchema: { type: 'object' } },
];
const secondPage = [{ name: 'fail', description: 'Always errors' }];

lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  if (message.method === undefined) return; // a reply to our ping
  if (message.method === 'initialize') {
    process.stdout.write('this line is not json\n');
    send({ jsonrpc: '2.0', id: 'server-ping', method: 'ping' });
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo' },
      },
    });
    return;
  }
  if (message.method === 'tools/list') {
    const cursor = message.params?.cursor;
    send({
      jsonrpc: '2.0',
      id: message.id,
      result:
        cursor === 'page-2' ? { tools: secondPage } : { tools: firstPage, nextCursor: 'page-2' },
    });
    return;
  }
  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params;
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [
            { type: 'text', text: `echo: ${args.text} token=abc123secret` },
            { type: 'image', mimeType: 'image/png', data: 'AAAA' },
          ],
        },
      });
      return;
    }
    if (name === 'hang') return;
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Unknown tool' } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
});
