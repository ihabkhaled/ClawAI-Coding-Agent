import { redactText } from './redaction';

/** Everything the report is allowed to know. Nothing else reaches it. */
export interface DiagnosticReportInput {
  readonly extensionVersion: string;
  readonly vscodeVersion: string;
  readonly platform: string;
  readonly locale: string;
  readonly backendOrigin: string;
  readonly backendStatus: string;
  readonly connected: boolean;
  readonly routingMode: string;
  readonly selectedModel: string;
  readonly permissionMode: string;
  readonly agentMode: string;
  readonly workspaceOpen: boolean;
  readonly workspaceTrusted: boolean;
  readonly lastError: string | undefined;
  readonly recentRunIds: readonly string[];
}

export const MAX_DIAGNOSTIC_REPORT_CHARACTERS = 20_000;

/**
 * The origin, never the whole URL.
 *
 * A configured backend URL is not supposed to carry credentials, a query or a
 * fragment — the connection screen refuses all three — but a report is exactly
 * the wrong place to find out that something slipped through, so it is rebuilt
 * from its parts rather than trimmed.
 */
export function backendOriginOnly(backendUrl: string): string {
  try {
    const parsed = new URL(backendUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '(unparseable)';
  }
}

function line(label: string, value: string): string {
  return `- **${label}:** ${value}`;
}

/**
 * Builds the diagnostic report a user reads before deciding to send anything.
 *
 * Every field is either a fixed enum, a version, or a value that has already
 * been through `redactText`. There is no transcript, no prompt, no file
 * content and no path: the point is to describe the *installation*, and a
 * report that quietly carried the user's code would be a disclosure channel
 * dressed as a support form.
 */
export function buildDiagnosticReport(input: DiagnosticReportInput): string {
  const report = [
    '## ClawAI diagnostic report',
    '',
    line('Extension', input.extensionVersion),
    line('VS Code', input.vscodeVersion),
    line('Platform', input.platform),
    line('Locale', input.locale),
    '',
    '### Connection',
    '',
    line('Backend', backendOriginOnly(input.backendOrigin)),
    line('Status', input.backendStatus),
    line('Connected', input.connected ? 'yes' : 'no'),
    '',
    '### Session',
    '',
    line('Routing', input.routingMode),
    line('Model', input.selectedModel.length === 0 ? '(automatic)' : input.selectedModel),
    line('Permission mode', input.permissionMode),
    line('Agent mode', input.agentMode),
    line('Workspace open', input.workspaceOpen ? 'yes' : 'no'),
    line('Workspace trusted', input.workspaceTrusted ? 'yes' : 'no'),
    '',
    '### Recent runs',
    '',
    input.recentRunIds.length === 0
      ? '- (none recorded)'
      : input.recentRunIds.map((runId) => `- ${runId}`).join('\n'),
    '',
    '### Last error',
    '',
    input.lastError === undefined ? '(none)' : redactText(input.lastError),
  ].join('\n');
  return report.slice(0, MAX_DIAGNOSTIC_REPORT_CHARACTERS);
}
