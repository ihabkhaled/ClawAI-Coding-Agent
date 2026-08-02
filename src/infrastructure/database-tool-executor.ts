import * as vscode from 'vscode';

import type { VscodeFileTransactionAdapter } from './vscode-file-transaction-adapter';
import type { ToolDefinition, ToolInvocation } from '../core/runtime/runtime-tool-contracts';
import type { DatabaseProfileVault } from '../services/database-profile-vault';
import type { DatabaseWorkbenchService } from '../services/database-workbench-service';
import type {
  RuntimeToolExecutionOutput,
  RuntimeToolExecutorPort,
} from '../services/runtime-tool-dispatcher';

export const databaseToolDefinition: ToolDefinition = {
  schemaVersion: '2.0',
  name: 'workspace.database',
  version: '2.0.0',
  description: 'Discover database stacks and run bounded queries or reviewed migrations.',
  operations: [
    'profiles',
    'discover',
    'introspect',
    'query',
    'explain',
    'migration-dry-run',
    'migration-apply',
  ],
  riskClasses: ['database-read', 'database-write', 'destructive'],
  targetIds: ['target:database'],
  inputSchema: { type: 'object', additionalProperties: true },
};

const migrationPatterns = [
  ['Prisma', '**/prisma/schema.prisma'],
  ['TypeORM', '**/*{migration,migrations}*.{ts,js}'],
  ['Sequelize', '**/.sequelizerc'],
  ['Knex', '**/knexfile.{ts,js,cjs,mjs}'],
  ['Drizzle', '**/drizzle.config.{ts,js}'],
  ['EF', '**/*.csproj'],
  ['Django', '**/manage.py'],
  ['Rails', '**/db/migrate/*.rb'],
  ['Flyway', '**/flyway.conf'],
  ['Liquibase', '**/liquibase*.{xml,yaml,yml,json,sql}'],
  ['SQL', '**/migrations/**/*.sql'],
] as const;

interface DatabaseDiscovery {
  readonly framework: string;
  readonly paths: readonly string[];
}

export class DatabaseToolExecutor implements RuntimeToolExecutorPort {
  constructor(
    private readonly profiles: DatabaseProfileVault,
    private readonly workbench: DatabaseWorkbenchService,
    private readonly files: VscodeFileTransactionAdapter,
  ) {}

  async execute(
    invocation: ToolInvocation,
    signal?: AbortSignal,
  ): Promise<RuntimeToolExecutionOutput> {
    if (invocation.toolName !== databaseToolDefinition.name)
      throw new Error('Unknown database tool');
    if (invocation.operation === 'profiles')
      return { structured: { profiles: this.profiles.list() } };
    if (invocation.operation === 'discover')
      return {
        structured: { discoveries: await this.discover(invocation.arguments.rootKey, signal) },
      };
    const receipt = await this.workbench.execute(
      { ...invocation.arguments, operation: invocation.operation },
      signal,
    );
    return { structured: { receipt } };
  }

  private async discover(
    rootKeyCandidate: unknown,
    signal?: AbortSignal,
  ): Promise<readonly DatabaseDiscovery[]> {
    if (typeof rootKeyCandidate !== 'string')
      throw new Error('Database discovery requires rootKey');
    const root = this.files.workspaceRootUri(rootKeyCandidate);
    const discoveries: { framework: string; paths: string[] }[] = [];
    for (const [framework, pattern] of migrationPatterns) {
      signal?.throwIfAborted();
      const matches = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root, pattern),
        '**/{node_modules,.git}/**',
        200,
      );
      if (matches.length > 0)
        discoveries.push({
          framework,
          paths: matches.map((uri) => vscode.workspace.asRelativePath(uri, false)),
        });
    }
    return discoveries;
  }
}
