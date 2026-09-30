import { describe, expect, it } from 'vitest';

import {
  EMPTY_MAILBOX,
  inboxFor,
  registerAddress,
  sendMessage,
} from '../../src/core/agent-mailbox';
import { prepareArtifact } from '../../src/core/artifact-publication';
import { buildDiagnosticReport } from '../../src/core/diagnostic-report';
import { otlpTracePayload } from '../../src/core/otlp-export';
import { redactText, redactValue } from '../../src/core/redaction';
import { slackMessageBody } from '../../src/core/slack-notification';
import { renderTranscriptExport } from '../../src/core/transcript-export';
import { OutputLogger } from '../../src/infrastructure/output-logger';

import type { ObservabilitySpan } from '../../src/services/observability-service';
import type * as vscode from 'vscode';

/**
 * Token-shaped values are assembled from parts so no literal in this file
 * matches a secret scanner. Each entry is [label, full text, the secret core
 * that must not survive].
 */
const BODY = ['Zx9Qm', '4Tk7Lp', '2Wd8Vn', '5Rb3Hc'].join('');
const JWT_SIGNATURE = ['s1gn', 'atureB0dy', 'Xyz12'].join('');
const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ1c2VyLTEifQ', JWT_SIGNATURE].join('.');
const PEM_BODY = ['MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', 'BKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj'].join('');
const PRIVATE_KEY = [
  ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
  PEM_BODY,
  ['-----END', 'PRIVATE KEY-----'].join(' '),
].join('\n');

interface Shape {
  readonly label: string;
  readonly text: string;
  readonly secret: string;
}

const SHAPES: readonly Shape[] = [
  { label: 'openai-style key', text: `key is ${['sk', 'proj', BODY].join('-')}`, secret: BODY },
  { label: 'github token', text: `token ${['ghp', BODY].join('_')} used`, secret: BODY },
  {
    label: 'aws access key',
    text: `id ${['AKIA', 'IOSFODNN7', 'EXAMPLE'].join('')}`,
    secret: 'IOSFODNN7EXAMPLE',
  },
  { label: 'bearer header', text: `Authorization: Bearer ${BODY}`, secret: BODY },
  { label: 'basic header', text: `Authorization: Basic ${BODY}==`, secret: BODY },
  { label: 'bare jwt', text: `session ${JWT} ended`, secret: JWT_SIGNATURE },
  { label: 'private key', text: `key:\n${PRIVATE_KEY}\nend`, secret: PEM_BODY },
  {
    label: 'password in url',
    text: `git clone https://alice:${BODY}@example.com/r.git`,
    secret: BODY,
  },
  { label: 'token in url', text: `https://${BODY}@example.com/r.git`, secret: BODY },
  { label: 'env line', text: `DATABASE_PASSWORD=${BODY}`, secret: BODY },
  { label: 'env line token', text: `GITHUB_TOKEN=${BODY}`, secret: BODY },
  { label: 'cookie header', text: `Cookie: sid=${BODY}; theme=dark`, secret: BODY },
  { label: 'cookie second value', text: `Cookie: theme=dark; sid=${BODY}`, secret: BODY },
  { label: 'set-cookie', text: `Set-Cookie: session=${BODY}; HttpOnly; Secure`, secret: BODY },
  { label: 'oauth code', text: `https://app.example.com/cb?code=${BODY}&state=abc`, secret: BODY },
  { label: 'oauth code json', text: JSON.stringify({ code: BODY, other: 1 }), secret: BODY },
  { label: 'refresh token json', text: JSON.stringify({ refresh_token: BODY }), secret: BODY },
  { label: 'refresh token query', text: `x?refresh_token=${BODY}`, secret: BODY },
  { label: 'client secret', text: `client_secret: ${BODY}`, secret: BODY },
  { label: 'id_token query', text: `cb#id_token=${JWT}`, secret: JWT_SIGNATURE },
];

function spanWith(text: string): ObservabilitySpan {
  return {
    name: 'runtime.v2.tool',
    traceId: 'trace-1',
    spanId: 'span-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    status: 'ok',
    attributes: { 'tool.command': text },
  };
}

function captureLogger(): { logger: OutputLogger; lines: string[] } {
  const lines: string[] = [];
  const channel: Pick<vscode.OutputChannel, 'appendLine' | 'show' | 'dispose'> = {
    appendLine: (line: string) => {
      lines.push(line);
    },
    show: () => undefined,
    dispose: () => undefined,
  };
  return { logger: new OutputLogger(channel as vscode.OutputChannel), lines };
}

function mailboxText(text: string): string {
  let mailbox = registerAddress(registerAddress(EMPTY_MAILBOX, 'a'), 'b');
  const result = sendMessage(mailbox, 'a', 'b', text);
  if (result.sent) mailbox = result.mailbox;
  return JSON.stringify({ mailbox, inbox: inboxFor(mailbox, 'b') });
}

const SINKS: readonly [string, (text: string) => string][] = [
  ['redactText', (text) => redactText(text)],
  ['redactValue nested', (text) => JSON.stringify(redactValue({ a: [{ b: text }] }))],
  [
    'output logger message',
    (text) => {
      const { logger, lines } = captureLogger();
      logger.info(text);
      return lines.join('\n');
    },
  ],
  [
    'output logger details',
    (text) => {
      const { logger, lines } = captureLogger();
      logger.error('boom', { detail: text, error: new Error(text).message });
      return lines.join('\n');
    },
  ],
  ['slack body', (text) => slackMessageBody(text).text],
  ['otlp span attribute', (text) => JSON.stringify(otlpTracePayload([spanWith(text)], 'svc', '1'))],
  [
    'artifact publish',
    (text) => {
      const prepared = prepareArtifact({ path: 'notes/a.txt', content: text });
      return prepared.status === 'ready' ? prepared.content + prepared.preview : '';
    },
  ],
  ['agent mailbox', (text) => mailboxText(text)],
  [
    'transcript export',
    (text) =>
      renderTranscriptExport({
        title: text,
        threadId: 't1',
        exportedAt: 0,
        format: 'markdown',
        messages: [{ role: 'user', content: text }],
      }),
  ],
  [
    'diagnostic report (feedback)',
    (text) =>
      buildDiagnosticReport({
        extensionVersion: '1',
        vscodeVersion: '1',
        platform: 'win32',
        locale: 'en',
        backendOrigin: 'https://claw.local',
        backendStatus: 'ok',
        connected: true,
        routingMode: 'auto',
        selectedModel: 'm',
        permissionMode: 'manual',
        agentMode: 'agent',
        workspaceOpen: true,
        workspaceTrusted: true,
        lastError: text,
        recentRunIds: [],
        sandbox: {
          kind: 'none',
          filesystemJail: false,
          networkIsolation: false,
          processContainment: false,
          summary: 'none',
        },
      }),
  ],
];

describe('privacy: secret corpus through every sink', () => {
  for (const [sinkName, sink] of SINKS) {
    describe(sinkName, () => {
      for (const shape of SHAPES) {
        it(`does not emit a ${shape.label}`, () => {
          const output = sink(shape.text);
          expect(output).not.toContain(shape.secret);
        });
      }
    });
  }
});
