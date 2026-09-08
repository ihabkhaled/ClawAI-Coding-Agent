import * as vscode from 'vscode';

import { DIAGNOSTIC_SEVERITIES } from '../core/workspace-diagnostics';

import type { DiagnosticSeverity, WorkspaceDiagnostic } from '../core/workspace-diagnostics';
import type { WorkspaceDiagnosticsPort } from '../services/workspace-intelligence-service';

/**
 * `vscode.DiagnosticSeverity` is an enum whose numbers run most-severe-first,
 * which is the same order the shared severity list uses. Mapping by index keeps
 * the two in step without a second literal table to drift.
 */
function severityOf(severity: vscode.DiagnosticSeverity): DiagnosticSeverity {
  return DIAGNOSTIC_SEVERITIES[severity];
}

function codeOf(code: vscode.Diagnostic['code']): string | undefined {
  if (code === undefined) return undefined;
  if (typeof code === 'string') return code;
  if (typeof code === 'number') return String(code);
  return String(code.value);
}

/**
 * Reads the Problems collection.
 *
 * Everything the language servers already computed was invisible to the model:
 * the only way to learn that a file had a type error was to run a full
 * `workspace.quality` gate and parse its stdout, which costs a build and only
 * covers the gates a project happens to define. The editor has the answer
 * already, per keystroke, for every installed analyzer.
 *
 * Paths are emitted workspace-relative and unresolved entries are dropped
 * rather than reported absolute; `selectDiagnostics` refuses anything that is
 * not relative, so an unrelated open document cannot reach the model here.
 */
export class VscodeWorkspaceDiagnostics implements WorkspaceDiagnosticsPort {
  current(): readonly WorkspaceDiagnostic[] {
    const collected: WorkspaceDiagnostic[] = [];
    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      const path = vscode.workspace.asRelativePath(uri, false);
      for (const diagnostic of diagnostics) {
        const code = codeOf(diagnostic.code);
        collected.push({
          path,
          line: diagnostic.range.start.line + 1,
          column: diagnostic.range.start.character + 1,
          severity: severityOf(diagnostic.severity),
          ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
          ...(code === undefined ? {} : { code }),
          message: diagnostic.message,
        });
      }
    }
    return collected;
  }
}
