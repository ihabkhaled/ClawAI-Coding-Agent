import { z } from 'zod';

import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';
import { findingsFromSarif, sarifLogSchema } from '../core/sarif';
import { MAX_SARIF_BYTES } from '../core/sarif.constants';

import type { SarifImportPort } from './sarif-import-tool-executor.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

const importSchema = z.object({ path: z.string().trim().min(1).max(1_000) });

export const sarifImportToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.scan',
  version: '2.0.0',
  description:
    'Read a security scanner SARIF report and record what it found as findings. import takes ' +
    'path, the workspace-relative report file — run the scanner yourself first, this does not ' +
    'run one. CWE tags and CVSS-style scores are preserved, results that name a file outside ' +
    'this workspace are dropped, and everything imported is recorded at medium confidence ' +
    'because a scanner reports what its rule matched, not whether it matters here.',
  operations: ['import'],
  riskClasses: ['inspect'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.scan,
};

/**
 * Reading what a scanner produced, rather than becoming one.
 *
 * The audit found zero CWE, CVE or SARIF references anywhere in either
 * repository: the secret regexes are leak prevention, and the workspace audit
 * is a prompt. Shipping a vulnerability database inside a VS Code extension is
 * the wrong shape — it is stale the day it ships and duplicates what the
 * project's own pipeline already runs. Reading SARIF is the right shape,
 * because every scanner worth using already emits it.
 *
 * Failures are reported rather than thrown. A missing report, a file that is
 * not JSON and a JSON file that is not SARIF are three different mistakes a
 * caller can fix, and each should cost one result rather than the run.
 */
export class SarifImportToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: SarifImportPort) {}

  async execute(invocation: ToolInvocation): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== sarifImportToolDefinition.name) {
      throw new Error('Unknown scan tool');
    }
    if (invocation.operation !== 'import') throw new Error('Unknown scan operation');
    const { path } = importSchema.parse(invocation.arguments);
    const text = await this.port.readReport(path);
    if (text === undefined) {
      return { structured: { imported: false, reason: 'unreadable', path } };
    }
    if (text.length > MAX_SARIF_BYTES) {
      return { structured: { imported: false, reason: 'too-large', path } };
    }
    const parsed = this.parse(text);
    if (parsed === undefined) {
      return { structured: { imported: false, reason: 'not-sarif', path } };
    }
    const findings = findingsFromSarif(parsed);
    const recorded = await this.port.record(findings);
    return {
      structured: {
        imported: true,
        path,
        // Both numbers, because they differ for a reason worth seeing: results
        // naming files outside this workspace are dropped, and a large gap
        // means the report was produced against a different tree.
        found: findings.length,
        recorded,
      },
    };
  }

  private parse(text: string): ReturnType<typeof sarifLogSchema.parse> | undefined {
    try {
      return sarifLogSchema.parse(JSON.parse(text));
    } catch {
      return undefined;
    }
  }
}
