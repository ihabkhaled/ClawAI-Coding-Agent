import { z } from 'zod';

import {
  advisoriesFor,
  dependencyAuditCommand,
  dependencyFindings,
} from '../core/dependency-audit';
import { DEPENDENCY_SCANNERS } from '../core/dependency-audit.constants';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import type { DependencyAuditPort } from './dependency-audit-tool-executor.types';
import type { DependencyAuditCommand, DependencyScanner } from '../core/dependency-audit.types';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const dependencyAuditToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.dependency-audit',
  version: '2.0.0',
  description:
    'Run a dependency vulnerability scanner that is already installed and record each known ' +
    'advisory as a finding against the lockfile. run takes scanner: auto (default), ' +
    'osv-scanner, npm or pip-audit. The scanner sends package names and versions to its ' +
    'advisory database; no source code leaves the machine. Nothing is installed: a scanner ' +
    'that is not on PATH is reported as unavailable. Findings are medium confidence, because ' +
    'an advisory says a version is affected, not that the vulnerable code is reachable.',
  operations: ['run'],
  riskClasses: ['process', 'network'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.dependencyAudit,
};

const runSchema = z
  .object({ scanner: z.enum(['auto', ...DEPENDENCY_SCANNERS]).default('auto') })
  .strict();

/**
 * Running the scanner a project already has, rather than shipping a database.
 *
 * The SARIF import left CVE lookup open because it needs either a shipped
 * database or a network call. This takes the network call, through a tool the
 * developer installed and trusts, behind the same approval any process run
 * takes — the operation is `run`, which the policy classifies as a local
 * process — so the permission mode decides, not this executor.
 *
 * Every auditor exits non-zero when it finds something, so a non-zero exit is
 * not a failure: output that is not the scanner's JSON is.
 */
export class DependencyAuditToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly port: DependencyAuditPort) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== dependencyAuditToolDefinition.name) {
      throw new Error('Unknown dependency audit tool');
    }
    if (invocation.operation !== 'run') throw new Error('Unknown dependency audit operation');
    const { scanner } = runSchema.parse(invocation.arguments);
    const command = await this.choose(scanner);
    if (command === undefined) {
      return { structured: { audited: false, reason: 'no-scanner', scanner } };
    }
    const output = await this.port.run(command, signal);
    if (output.timedOut || output.truncated) {
      return {
        structured: {
          audited: false,
          reason: output.timedOut ? 'timed-out' : 'too-large',
          scanner: command.scanner,
        },
      };
    }
    const json = this.parse(output.stdout);
    if (json === undefined) {
      return { structured: { audited: false, reason: 'not-json', scanner: command.scanner } };
    }
    const advisories = advisoriesFor(command.scanner, json, command.manifest, (path) =>
      this.port.relativize(path),
    );
    const findings = dependencyFindings(advisories, command.scanner);
    return {
      structured: {
        audited: true,
        scanner: command.scanner,
        manifest: command.manifest,
        advisories: advisories.length,
        recorded: findings.length === 0 ? 0 : this.port.record(findings),
      },
    };
  }

  private async choose(
    requested: 'auto' | DependencyScanner,
  ): Promise<DependencyAuditCommand | undefined> {
    const manifests = await this.port.manifests();
    const candidates = requested === 'auto' ? DEPENDENCY_SCANNERS : [requested];
    for (const scanner of candidates) {
      const command = dependencyAuditCommand(scanner, manifests);
      if (command !== undefined && (await this.port.available(command.executable))) {
        return command;
      }
    }
    return undefined;
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }
}
