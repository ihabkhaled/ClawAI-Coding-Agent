import { describe, expect, it } from 'vitest';

import {
  backendOriginOnly,
  buildDiagnosticReport,
  MAX_DIAGNOSTIC_REPORT_CHARACTERS,
  type DiagnosticReportInput,
} from '../../src/core/diagnostic-report';
import { sandboxGuarantees } from '../../src/core/sandbox-capability';

const input: DiagnosticReportInput = {
  extensionVersion: '0.89.0',
  vscodeVersion: '1.98.2',
  platform: 'win32',
  sandbox: sandboxGuarantees('none'),
  locale: 'en',
  backendOrigin: 'https://claw.local',
  backendStatus: 'connected',
  connected: true,
  routingMode: 'AUTO',
  selectedModel: '',
  permissionMode: 'MANUAL',
  agentMode: 'AUTO',
  workspaceOpen: true,
  workspaceTrusted: true,
  lastError: undefined,
  recentRunIds: ['runtime:one', 'runtime:two'],
};

describe('backendOriginOnly', () => {
  it('keeps only the origin', () => {
    expect(backendOriginOnly('https://claw.local/api/v1?token=abc#x')).toBe('https://claw.local');
  });

  it('drops credentials embedded in the URL', () => {
    const origin = backendOriginOnly('https://user:secret@claw.local/api');

    expect(origin).toBe('https://claw.local');
    expect(origin).not.toContain('secret');
  });

  it('reports an unparseable URL rather than echoing it back', () => {
    expect(backendOriginOnly('not a url')).toBe('(unparseable)');
  });
});

describe('buildDiagnosticReport', () => {
  it('describes the installation, connection and session', () => {
    const report = buildDiagnosticReport(input);

    expect(report).toContain('**Extension:** 0.89.0');
    expect(report).toContain('**VS Code:** 1.98.2');
    expect(report).toContain('**Backend:** https://claw.local');
    expect(report).toContain('**Permission mode:** MANUAL');
    expect(report).toContain('- runtime:one');
  });

  it('says the model is automatic rather than printing an empty value', () => {
    expect(buildDiagnosticReport(input)).toContain('**Model:** (automatic)');
  });

  it('redacts a credential that reached the last error', () => {
    const report = buildDiagnosticReport({
      ...input,
      lastError: 'Request failed: authorization: Bearer sk-live-1234567890',
    });

    expect(report).not.toContain('sk-live-1234567890');
    expect(report).toContain('[REDACTED]');
  });

  it('says so when nothing failed and nothing ran', () => {
    const report = buildDiagnosticReport({ ...input, lastError: undefined, recentRunIds: [] });

    expect(report).toContain('(none)');
    expect(report).toContain('(none recorded)');
  });

  it('never carries a prompt, a path or file content', () => {
    const report = buildDiagnosticReport(input);

    // The input type has no field for any of them; this guards the shape from
    // growing one by accident later.
    expect(report).not.toMatch(/prompt|transcript|contents/iu);
  });

  it('bounds the report to what the backend accepts', () => {
    const report = buildDiagnosticReport({
      ...input,
      lastError: 'x'.repeat(MAX_DIAGNOSTIC_REPORT_CHARACTERS * 2),
    });

    expect(report.length).toBeLessThanOrEqual(MAX_DIAGNOSTIC_REPORT_CHARACTERS);
  });
});
