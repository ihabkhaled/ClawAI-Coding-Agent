import * as vscode from 'vscode';
import { z } from 'zod';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ServiceDefinition } from '../core/development-service';

export interface DiscoveredDevelopmentService {
  readonly source: string;
  readonly confidence: 'exact' | 'high' | 'medium';
  readonly definition: ServiceDefinition;
}

const packageSchema = z.looseObject({
  name: z.string().max(200).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});
const tasksSchema = z.looseObject({
  tasks: z.array(z.looseObject({ label: z.string().min(1).max(200) })).max(500),
});

const discoveryPatterns = [
  ['Compose', '**/{compose,docker-compose}*.{yml,yaml}', 'compose'],
  ['VS Code task', '**/.vscode/tasks.json', 'vscode-task'],
  ['Procfile', '**/Procfile', 'process'],
  ['Make', '**/Makefile', 'process'],
  ['Gradle', '**/{build.gradle,build.gradle.kts}', 'process'],
  ['.NET launch profile', '**/Properties/launchSettings.json', 'process'],
  ['Python server', '**/{manage.py,app.py,main.py}', 'process'],
] as const;

export class DevelopmentServiceDiscovery {
  constructor(private readonly files: VscodeFileTransactionAdapter) {}

  async discover(
    rootKey: string,
    signal?: AbortSignal,
  ): Promise<readonly DiscoveredDevelopmentService[]> {
    const root = this.files.workspaceRootUri(rootKey);
    const discovered = await this.discoverPackageScripts(rootKey, root, signal);
    for (const [label, pattern, kind] of discoveryPatterns) {
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, pattern),
        '**/{node_modules,.git,dist,build}/**',
        1_000,
      );
      for (const uri of matches) {
        signal?.throwIfAborted();
        const relative = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
        if (kind === 'vscode-task') {
          const parsed = tasksSchema.safeParse(
            JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
          );
          if (!parsed.success) continue;
          for (const task of parsed.data.tasks) {
            discovered.push(this.vscodeTaskDefinition(rootKey, relative, task.label));
          }
          continue;
        }
        discovered.push(this.discoveredDefinition(rootKey, label, relative, kind));
      }
    }
    return discovered;
  }

  private async discoverPackageScripts(
    rootKey: string,
    root: vscode.Uri,
    signal?: AbortSignal,
  ): Promise<DiscoveredDevelopmentService[]> {
    const discovered: DiscoveredDevelopmentService[] = [];
    const packages = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/package.json'),
      '**/{node_modules,.git,dist,build}/**',
      2_000,
    );
    for (const uri of packages) {
      signal?.throwIfAborted();
      const parsed = packageSchema.safeParse(
        JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))),
      );
      if (!parsed.success) continue;
      const relative = vscode.workspace.asRelativePath(uri, false).replaceAll('\\', '/');
      const cwd = this.parent(relative);
      const packageManager = await this.packageManager(root, cwd);
      for (const script of ['dev', 'start', 'serve', 'preview']) {
        if (parsed.data.scripts?.[script] === undefined) continue;
        discovered.push({
          source: relative,
          confidence: 'high',
          definition: this.processDefinition(
            rootKey,
            this.identifier(`${parsed.data.name ?? cwd}-${script}`),
            `${parsed.data.name ?? cwd} · ${script}`,
            cwd,
            packageManager,
            ['run', script],
          ),
        });
      }
    }
    return discovered;
  }

  private discoveredDefinition(
    rootKey: string,
    label: string,
    relative: string,
    kind: 'compose' | 'process',
  ): DiscoveredDevelopmentService {
    const serviceId = this.identifier(`${label}-${relative}`);
    const displayLabel = `${label} · ${relative}`;
    if (kind === 'compose') {
      return {
        source: relative,
        confidence: 'medium',
        definition: {
          serviceId,
          label: displayLabel,
          kind,
          targetId: 'target:container',
          dependencies: [],
          containerOperation: { operation: 'compose-up', rootKey, file: relative },
          expectedPorts: [],
          environmentOverlay: {},
          restartPolicy: 'on-change',
          maxRestarts: 3,
          restartWindowMs: 60_000,
        },
      };
    }
    const command = this.commandFor(relative);
    return {
      source: relative,
      confidence: 'medium',
      definition: this.processDefinition(
        rootKey,
        serviceId,
        displayLabel,
        this.parent(relative),
        command.executable,
        command.arguments,
      ),
    };
  }

  private vscodeTaskDefinition(
    rootKey: string,
    source: string,
    taskName: string,
  ): DiscoveredDevelopmentService {
    return {
      source,
      confidence: 'exact',
      definition: {
        serviceId: this.identifier(`vscode-task-${taskName}`),
        label: `VS Code task · ${taskName}`,
        kind: 'vscode-task',
        targetId: 'target:workspace',
        dependencies: [],
        containerOperation: { taskName, rootKey },
        expectedPorts: [],
        environmentOverlay: {},
        restartPolicy: 'on-change',
        maxRestarts: 3,
        restartWindowMs: 60_000,
      },
    };
  }

  private processDefinition(
    rootKey: string,
    serviceId: string,
    label: string,
    cwd: string,
    executable: string,
    arguments_: readonly string[],
  ): ServiceDefinition {
    return {
      serviceId,
      label,
      kind: 'process',
      targetId: 'target:workspace',
      dependencies: [],
      command: {
        executable,
        arguments: [...arguments_],
        cwdRootKey: rootKey,
        cwd,
        environment: {},
        timeoutMs: 86_400_000,
        outputLimitBytes: 1_048_576,
        expectedEffect: 'local-mutation',
        targetId: 'target:workspace',
        elevation: false,
      },
      expectedPorts: [],
      environmentOverlay: {},
      restartPolicy: 'on-change',
      maxRestarts: 3,
      restartWindowMs: 60_000,
    };
  }

  private commandFor(relative: string): {
    readonly executable: string;
    readonly arguments: readonly string[];
  } {
    const filename = relative.slice(relative.lastIndexOf('/') + 1);
    if (filename === 'Procfile')
      return { executable: 'foreman', arguments: ['start', '-f', filename] };
    if (filename === 'Makefile') return { executable: 'make', arguments: [] };
    if (filename === 'build.gradle' || filename === 'build.gradle.kts') {
      return {
        executable: process.platform === 'win32' ? 'gradlew.bat' : './gradlew',
        arguments: ['bootRun'],
      };
    }
    if (filename === 'launchSettings.json') return { executable: 'dotnet', arguments: ['run'] };
    if (filename === 'manage.py')
      return { executable: 'python', arguments: ['manage.py', 'runserver'] };
    return { executable: 'python', arguments: [filename] };
  }

  private parent(relative: string): string {
    return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '.';
  }

  private async packageManager(
    root: vscode.Uri,
    cwd: string,
  ): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
    for (const [lockfile, manager] of [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['bun.lockb', 'bun'],
    ] as const) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, cwd, lockfile));
        return manager;
      } catch {
        // Continue to the next repository-owned package manager marker.
      }
    }
    return 'npm';
  }

  private identifier(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/gu, '-')
      .replace(/^-+|-+$/gu, '');
    return /^[a-z]/u.test(normalized)
      ? normalized.slice(0, 100)
      : `service-${normalized}`.slice(0, 100);
  }
}
