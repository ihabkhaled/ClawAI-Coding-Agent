import * as vscode from 'vscode';
import { z } from 'zod';

import {
  parseQualityDiagnostics,
  inspectQualityEvidence,
  planQualityExecution,
  qualityProjectSchema,
  type QualityGate,
  type QualityProject,
} from '../core/quality-graph';
import { runtimeToolInputSchemas } from '../core/runtime/runtime-tool-input-schemas';

import { runCommandSpec } from './bounded-command-runner';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const qualityToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.quality',
  version: '2.0.0',
  description: 'Discover, plan, and execute bounded repository quality gates.',
  operations: ['discover', 'plan', 'run'],
  riskClasses: ['process'],
  targetIds: ['target:workspace'],
  inputSchema: runtimeToolInputSchemas.quality,
};

const inputSchema = z
  .object({
    rootKey: z.string().min(1).max(100),
    scope: z.enum(['focused', 'delivery']).default('focused'),
    projects: z.array(qualityProjectSchema).max(500).optional(),
    gateId: z.string().min(3).max(200).optional(),
  })
  .strict();

const ecosystems = [
  { ecosystem: 'javascript', pattern: '**/package.json' },
  { ecosystem: 'python', pattern: '**/{pyproject.toml,setup.py,pytest.ini}' },
  { ecosystem: 'jvm', pattern: '**/{pom.xml,build.gradle,build.gradle.kts}' },
  { ecosystem: 'dotnet', pattern: '**/*.{sln,csproj,fsproj}' },
  { ecosystem: 'go', pattern: '**/go.mod' },
  { ecosystem: 'rust', pattern: '**/Cargo.toml' },
  { ecosystem: 'ruby', pattern: '**/Gemfile' },
  { ecosystem: 'php', pattern: '**/composer.json' },
  { ecosystem: 'mobile', pattern: '**/{pubspec.yaml,Podfile}' },
  { ecosystem: 'shell', pattern: '**/{Makefile,Taskfile.yml}' },
] as const;

export class QualityToolExecutor implements RuntimeToolExecutorPort {
  constructor(private readonly files: VscodeFileTransactionAdapter) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== qualityToolDefinition.name) throw new Error('Unknown quality tool');
    const input = inputSchema.parse(invocation.arguments);
    if (invocation.operation === 'discover') {
      return { structured: { projects: await this.discoverProjects(input.rootKey, signal) } };
    }
    const projects = z.array(qualityProjectSchema).parse(input.projects ?? []);
    const plan = planQualityExecution(projects, input.scope);
    if (invocation.operation === 'plan') return { structured: { plan } };
    if (invocation.operation !== 'run' || input.gateId === undefined)
      throw new Error('Quality run requires gateId');
    const gate = plan.gates.find((candidate) => candidate.gateId === input.gateId);
    if (gate === undefined) throw new Error('Quality gate is outside the selected plan');
    return this.runGate(gate, signal);
  }

  async discoverProjects(
    rootKey: string,
    signal?: AbortSignal,
  ): Promise<readonly QualityProject[]> {
    const root = this.files.workspaceRootUri(rootKey);
    const projects: QualityProject[] = [];
    for (const candidate of ecosystems) {
      signal?.throwIfAborted();
      const manifests = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, candidate.pattern),
        '**/{node_modules,.git,vendor,target,dist,build}/**',
        1_000,
      );
      for (const manifest of manifests) {
        const relativeManifest = vscode.workspace
          .asRelativePath(manifest, false)
          .replaceAll('\\', '/');
        const relativeRoot = relativeManifest.includes('/')
          ? relativeManifest.slice(0, relativeManifest.lastIndexOf('/'))
          : '.';
        const projectId = `${candidate.ecosystem}:${relativeRoot}`;
        projects.push(
          qualityProjectSchema.parse({
            projectId,
            rootKey,
            relativeRoot,
            ecosystem: candidate.ecosystem,
            manifests: [relativeManifest],
            changedPaths: [],
            gates: this.defaultGates(projectId, rootKey, relativeRoot, candidate.ecosystem),
          }),
        );
      }
    }
    return projects;
  }

  private defaultGates(
    projectId: string,
    rootKey: string,
    cwd: string,
    ecosystem: QualityProject['ecosystem'],
  ): readonly QualityGate[] {
    const commands: Partial<
      Record<QualityProject['ecosystem'], readonly [string, string[], QualityGate['kind']][]>
    > = {
      javascript: [
        ['npm', ['test', '--', '--runInBand'], 'unit'],
        ['npm', ['run', 'build'], 'build'],
      ],
      python: [['python', ['-m', 'pytest'], 'unit']],
      jvm: [['gradle', ['test'], 'unit']],
      dotnet: [['dotnet', ['test'], 'unit']],
      go: [['go', ['test', './...'], 'unit']],
      rust: [['cargo', ['test'], 'unit']],
      ruby: [['bundle', ['exec', 'rspec'], 'unit']],
      php: [['php', ['vendor/bin/phpunit'], 'unit']],
      mobile: [['flutter', ['test'], 'unit']],
      shell: [['make', ['test'], 'unit']],
    };
    return (commands[ecosystem] ?? []).map(([executable, arguments_, kind], index) => ({
      gateId: `${projectId}:${kind}:${String(index)}`,
      projectId,
      kind,
      command: {
        executable,
        arguments: arguments_,
        cwdRootKey: rootKey,
        cwd,
        environment: {},
        timeoutMs: 1_800_000,
        outputLimitBytes: 4_194_304,
        expectedEffect: kind === 'build' ? 'build' : 'test',
        targetId: 'target:workspace',
        elevation: false,
      },
      prerequisites: [],
      artifacts: [],
      mandatoryForDelivery: true,
      owner: projectId,
    }));
  }

  async runGate(gate: QualityGate, signal?: AbortSignal): Promise<RuntimeToolExecutionOutput> {
    const root = this.files.workspaceRootUri(gate.command.cwdRootKey);
    const cwd = vscode.Uri.joinPath(root, gate.command.cwd);
    const result = await runCommandSpec(gate.command, cwd.fsPath, signal);
    return {
      structured: {
        gateId: gate.gateId,
        status:
          result.exitCode === 0 && !result.timedOut && !result.cancelled ? 'passed' : 'failed',
        result,
        diagnostics: parseQualityDiagnostics(`${result.stdout}\n${result.stderr}`),
        signals: inspectQualityEvidence(`${result.stdout}\n${result.stderr}`),
        rootCauseRequired: result.exitCode !== 0,
      },
    };
  }
}
